import { createTestCadence } from './test-cadence.js'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaAcquisition, AlpacaFrame } from '@vela/alpaca'
import { createAlignmentController } from './controller.js'
import type { MonoFrame, PlateSolver, SkyPosition, SolveResult } from './solver.js'

const cadence = createTestCadence()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void

  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

const settings = { endpoint: 'http://simulator', cameraId: 'camera', telescopeId: 'mount',
  executable: '/unused', catalogPath: '/unused', exposureSeconds: 1, fieldHeightDegrees: 3 }

const stops: Array<ReturnType<typeof createAlignmentController>['stop']> = []

afterEach(async () => {
  await Promise.all(stops.splice(0).map(stop => stop()))
  expect(cadence.waits).toHaveLength(0)
})

function setup() {
  let ra = 10
  let dec = 60
  let coordinateSystem: Awaited<ReturnType<AlpacaAcquisition['pointing']>>['coordinateSystem'] = 'j2000'
  let exposures = 0
  let moves = 0
  let siderealOffset = 0
  let captureOverride: ((signal: AbortSignal) => Promise<AlpacaFrame>) | undefined
  const requests: Array<{ frame: MonoFrame, hint: SkyPosition, result: ReturnType<typeof deferred<SolveResult>> }> = []

  const hardware: AlpacaAcquisition = {
    rotateRightAscension: async () => { throw new Error('Unexpected physical rotation') },
    async pointing() { return { rightAscensionDegrees: ra, declinationDegrees: dec,
      siderealTimeDegrees: ((exposures + 1) * 360 / 86164.0905 + siderealOffset + 360) % 360, latitudeDegrees: 40, tracking: true, coordinateSystem } },
    async capture({ signal }) {
      exposures++

      if (captureOverride) return captureOverride(signal!)

      return { width: 4, height: 4, pixels: new Float64Array([0, 500, 300, 100, ...Array(12).fill(0)]),
        capturedAt: new Date(1_700_000_000_000 + exposures * 1000).toISOString(), color: { kind: 'mono' } }
    },
    async move(_id, rate, duration) {
      moves++
      ra += rate * duration
    },
    async abort() {},
  }

  const solver: PlateSolver = {
    solve(frame, hint, signal) {
      const result = deferred<SolveResult>()
      const abort = () => result.reject(new DOMException('Stopped', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      requests.push({ frame, hint, result })

      return result.promise.finally(() => signal.removeEventListener('abort', abort))
    },
  }

  const controller = createAlignmentController({ mode: 'offline', settings, hardware, solver, waitForNextExposure: cadence.wait, now: () => 1_700_000_000_000 + (exposures + 1) * 1000 })
  stops.push(() => controller.stop())

  async function nextSolve() {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))

    return requests.shift()!
  }

  function solve(request: Awaited<ReturnType<typeof nextSolve>>, decDegrees = 60) {
    request.result.resolve({ status: 'solved', capturedAt: request.frame.capturedAt,
      raDegrees: request.hint.raDegrees, decDegrees,
      wcs: { width: 4, height: 4, referenceX: 2.5, referenceY: 2.5,
        raDegrees: request.hint.raDegrees, decDegrees, cd: [0.01, 0, 0, -0.01] } })
  }

  async function baseline() {
    await controller.start('sim', 'Simulator')

    for (let position = 0; position < 3; position++) solve(await nextSolve())
    await vi.waitFor(() => expect(controller.snapshot().measurement).not.toBeNull())
  }

  return { controller, nextSolve, solve, baseline, exposures: () => exposures, moves: () => moves,
    setPointing: (position: { ra: number, dec: number, frame: typeof coordinateSystem }) => {
      ra = position.ra
      dec = position.dec
      coordinateSystem = position.frame
    },
    resetSidereal: () => { siderealOffset -= 10 },
    setCapture: (capture: typeof captureOverride) => { captureOverride = capture } }
}

it('rejects another start while acquisition remains active', async () => {
  const subject = setup()
  await subject.controller.start('sim', 'Simulator')
  await subject.nextSolve()
  await expect(subject.controller.start('other', 'Other rig')).rejects.toThrow('already running')
  expect(subject.controller.snapshot()).toMatchObject({ rigId: 'sim', active: true, activity: 'solving' })
  expect(subject.exposures()).toBe(1)
})

it('publishes a baseline image before solving and preserves it through no-solution and stop', async () => {
  const subject = setup()
  await subject.controller.start('sim', 'Simulator')
  const request = await subject.nextSolve()
  const preview = subject.controller.snapshot().preview!
  expect(preview).toMatchObject({ capturedAt: request.frame.capturedAt, position: 1, imageWidth: 4, imageHeight: 4 })
  expect(subject.controller.snapshot().measurement).toBeNull()
  expect(subject.controller.snapshot().measuredAt).toBeNull()
  const id = preview.imageUrl.split('/').at(-1)!
  expect(subject.controller.image(id)?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  request.result.resolve({ status: 'no-solution' })
  await vi.waitFor(() => expect(subject.controller.snapshot().warning).toContain('Plate-solving failed'))
  expect(subject.controller.snapshot().preview).toBe(preview)
  await subject.controller.stop()
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'stopped', preview, measurement: null })
})

it('keeps the solved image retrievable after repeated failed adjustment images', async () => {
  const subject = setup()
  await subject.baseline()
  const measurement = subject.controller.snapshot().measurement!
  const id = measurement.imageUrl.split('/').at(-1)!
  const image = subject.controller.image(id)

  for (let attempt = 0; attempt < 6; attempt++) {
    cadence.waits.shift()!()
    const request = await subject.nextSolve()
    request.result.resolve({ status: 'no-solution' })
    await vi.waitFor(() => expect(cadence.waits).toHaveLength(1))
  }

  expect(subject.controller.snapshot().measurement).toBe(measurement)
  expect(subject.controller.image(id)).toBe(image)
})

it.each([false, true])('waits for exposure cleanup before stopping and preserves cleanup failure=%s', async failCleanup => {
  const subject = setup()
  const cleanup = deferred<AlpacaFrame>()
  let aborted = false
  subject.setCapture(signal => {
    signal.addEventListener('abort', () => { aborted = true }, { once: true })

    return cleanup.promise
  })
  await subject.controller.start('sim', 'Simulator')
  await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('exposing'))
  const stop = subject.controller.stop()
  let settled = false
  void stop.then(() => { settled = true })
  await Promise.resolve()
  expect(aborted).toBe(true)
  expect(settled).toBe(false)
  expect(subject.controller.snapshot()).toMatchObject({ active: true, activity: 'stopping' })
  cleanup.reject(failCleanup ? new Error('Camera did not confirm exposure stopped') : new DOMException('Stopped', 'AbortError'))
  const result = await stop
  expect(result.active).toBe(false)
  expect(result.phase).toBe(failCleanup ? 'failed' : 'stopped')
  expect(result.error).toBe(failCleanup ? 'Camera did not confirm exposure stopped' : null)
})

it('publishes image and readings together only after a solve, retaining the last good result through retries', async () => {
  const subject = setup()
  await subject.baseline()
  const previous = subject.controller.snapshot()
  expect(previous.phase).toBe('adjusting')
  expect(previous.measurement!.totalArcsec).toBeLessThan(0.001)
  const previousImageId = previous.measurement!.imageUrl.split('/').at(-1)!
  expect(subject.controller.image(previousImageId)?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  cadence.waits.shift()!()
  const blank = await subject.nextSolve()
  expect(subject.controller.snapshot().measurement).toBe(previous.measurement)
  blank.result.resolve({ status: 'no-solution' })
  await vi.waitFor(() => expect(subject.controller.snapshot().warning).toContain('Plate-solving failed'))
  expect(subject.controller.snapshot()).toMatchObject({ measuredAt: previous.measuredAt, measurement: previous.measurement })
  cadence.waits.shift()!()
  const fresh = await subject.nextSolve()
  expect(subject.controller.snapshot().measurement).toBe(previous.measurement)
  subject.solve(fresh, 59.99)
  await vi.waitFor(() => expect(subject.controller.snapshot().measuredAt).toBe(fresh.frame.capturedAt))
  const updated = subject.controller.snapshot()
  expect(updated.warning).toBeNull()
  expect(updated.measurement!.totalArcsec).toBeGreaterThan(1)
  expect(updated.measurement!.imageUrl).not.toBe(previous.measurement!.imageUrl)
  expect(subject.controller.image(updated.measurement!.imageUrl.split('/').at(-1)!)).toBeDefined()

  cadence.waits.shift()!()
  const secondBlank = await subject.nextSolve()
  secondBlank.result.resolve({ status: 'no-solution' })
  await vi.waitFor(() => expect(subject.controller.snapshot().warning).toContain('Plate-solving failed'))
  const count = subject.exposures()
  await subject.controller.stop()
  expect(subject.controller.snapshot()).toMatchObject({ active: false, phase: 'stopped', measurement: updated.measurement })
  expect(cadence.waits).toHaveLength(0)
  await Promise.resolve()
  expect(subject.exposures()).toBe(count)
})


it('stops with the last good image retained when a simulator reset changes the sidereal reference', async () => {
  const subject = setup()
  await subject.baseline()
  const previous = subject.controller.snapshot()
  subject.resetSidereal()
  cadence.waits.shift()!()
  subject.solve(await subject.nextSolve())
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', measurement: previous.measurement, measuredAt: previous.measuredAt })
  expect(subject.controller.snapshot().error).toContain('rig clock or simulator baseline changed')
  expect(cadence.waits).toHaveLength(0)
})


it.each([
  { ra: 30, dec: 60, frame: 'other' as const },
  { ra: 30, dec: 60, frame: 'topocentric' as const },
  { ra: 30, dec: -14, frame: 'j2000' as const },
  { ra: 274, dec: 60, frame: 'j2000' as const },
])('requires the declared simulator frame and reset alignment position before moving: %j', async position => {
  const subject = setup()
  subject.setPointing(position)
  await subject.controller.start('sim', 'Simulator')
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  expect(subject.controller.snapshot().phase).toBe('failed')
  expect(subject.exposures()).toBe(0)
  expect(subject.moves()).toBe(0)
})
