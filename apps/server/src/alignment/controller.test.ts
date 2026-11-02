import { createTestCadence } from './test-cadence.js'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaAcquisition, AlpacaFrame } from '@vela/alpaca'
import { CaptureRetryableError, EquipmentError } from '@vela/equipment'
import { createAlignmentController } from './controller.js'
import type { AlignmentDiagnosticRun } from './diagnostics.js'
import { prepareAlignmentDisplay } from './display.js'
import type { AstapSolver } from '@vela/rig-astap'
import { astapReturning, falseSolve, fieldHeightDegreesFor } from '../plate-solving/false-solve.js'
import {
  judgedSolver,
  type MonoFrame,
  type PlateSolver,
  type SkyPosition,
  type SolveResult,
} from '../plate-solving/judged-solver.js'

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

const settings = {
  endpoint: 'http://simulator',
  cameraId: 'camera',
  telescopeId: 'mount',
  executable: '/unused',
  catalogPath: '/unused',
  exposureSeconds: 1,
  fieldHeightDegrees: 3,
}

/** A journal that remembers what the controller wrote to it. */
function recording() {
  return {
    recordRejected: vi.fn<AlignmentDiagnosticRun['recordRejected']>(async () => {}),
    recordFrame: vi.fn<AlignmentDiagnosticRun['recordFrame']>(async () => {}),
    recordFit: vi.fn<AlignmentDiagnosticRun['recordFit']>(async () => {}),
    recordDropped: vi.fn<AlignmentDiagnosticRun['recordDropped']>(async () => {}),
    recordMeasurement: vi.fn<AlignmentDiagnosticRun['recordMeasurement']>(async () => {}),
    finish: vi.fn<AlignmentDiagnosticRun['finish']>(async () => {}),
  }
}

const stops: Array<ReturnType<typeof createAlignmentController>['stop']> = []

afterEach(async () => {
  await Promise.all(stops.splice(0).map(stop => stop()))
  expect(cadence.waits).toHaveLength(0)
})

function setup(
  openDiagnostics?: Parameters<typeof createAlignmentController>[0]['openDiagnostics'],
  astap?: AstapSolver,
) {
  let ra = 10
  let dec = 60

  let coordinateSystem: Awaited<ReturnType<AlpacaAcquisition['pointing']>>['coordinateSystem'] =
    'j2000'

  let exposures = 0
  const requestedExposures: number[] = []
  let moves = 0
  let siderealOffset = 0
  let captureOverride: ((signal: AbortSignal) => Promise<AlpacaFrame>) | undefined
  let displays = 0
  const heldDisplays = new Map<number, ReturnType<typeof deferred<void>>>()

  const requests: Array<{
    frame: MonoFrame
    hint: SkyPosition
    result: ReturnType<typeof deferred<SolveResult>>
  }> = []

  const hardware: AlpacaAcquisition = {
    rotateRightAscension: async () => {
      throw new Error('Unexpected physical rotation')
    },
    async pointing() {
      return {
        rightAscensionDegrees: ra,
        declinationDegrees: dec,
        siderealTimeDegrees: (((exposures + 1) * 360) / 86164.0905 + siderealOffset + 360) % 360,
        latitudeDegrees: 33.45,
        tracking: true,
        coordinateSystem,
      }
    },
    async capture({ signal, exposureSeconds }) {
      exposures++
      requestedExposures.push(exposureSeconds)

      if (captureOverride) return captureOverride(signal!)

      return {
        width: 4,
        height: 4,
        pixels: new Float64Array([0, 500, 300, 100, ...Array(12).fill(0)]),
        capturedAt: new Date(1_700_000_000_000 + exposures * 1000).toISOString(),
        color: { kind: 'mono' },
      }
    },
    async move(_id, rate, duration) {
      moves++
      ra += rate * duration
    },
    async abort() {},
  }

  const deferredSolver: PlateSolver = {
    solve(frame, hint, _claimed, signal) {
      const result = deferred<SolveResult>()
      const abort = () => result.reject(new DOMException('Stopped', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      requests.push({ frame, hint, result })

      return result.promise.finally(() => signal.removeEventListener('abort', abort))
    },
  }

  const solver = astap ? judgedSolver(astap, fieldHeightDegreesFor(4), 'alignment') : deferredSolver

  const controller = createAlignmentController({
    mode: 'offline',
    settings,
    hardware,
    solver,
    openDiagnostics,
    waitForNextExposure: cadence.wait,
    now: () => 1_700_000_000_000 + (exposures + 1) * 1000,
    async prepareDisplay(frame, signal) {
      const held = heldDisplays.get(++displays)

      if (held)
        await Promise.race([
          held.promise,
          new Promise((_resolve, reject) =>
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
          ),
        ])

      return prepareAlignmentDisplay(frame, signal)
    },
  })

  stops.push(() => controller.stop())

  async function nextSolve() {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))

    return requests.shift()!
  }

  /** A solve at the pointing the mount reported, the camera rolled `rollDegrees` from the sky's north. */
  function solve(request: Awaited<ReturnType<typeof nextSolve>>, decDegrees = 60, rollDegrees = 0) {
    const roll = (rollDegrees * Math.PI) / 180

    request.result.resolve({
      status: 'solved',
      capturedAt: request.frame.capturedAt,
      raDegrees: request.hint.raDegrees,
      decDegrees,
      wcs: {
        width: 4,
        height: 4,
        referenceX: 2.5,
        referenceY: 2.5,
        raDegrees: request.hint.raDegrees,
        decDegrees,
        cd: [0.01 * Math.cos(roll), 0.01 * Math.sin(roll), 0.01 * Math.sin(roll), -0.01 * Math.cos(roll)],
      },
    })
  }

  /** The six positions of the sweep, solved; `unsolved` gives up on those positions (1 to 6). */
  async function sweep(unsolved: number[] = []) {
    await controller.start('sim', 'Simulator')

    for (let position = 1; position <= 6; position++) {
      const request = await nextSolve()

      if (unsolved.includes(position)) request.result.resolve({ status: 'no-solution', reasons: ['no-match'] })
      else solve(request)
    }
  }

  async function baseline() {
    await sweep()
    await vi.waitFor(() => expect(controller.snapshot().measurement).not.toBeNull())
  }

  return {
    controller,
    nextSolve,
    solve,
    baseline,
    sweep,
    exposures: () => exposures,
    requestedExposures,
    moves: () => moves,
    rightAscension: () => ra,
    setPointing: (position: { ra: number; dec: number; frame: typeof coordinateSystem }) => {
      ra = position.ra
      dec = position.dec
      coordinateSystem = position.frame
    },
    resetSidereal: () => {
      siderealOffset -= 10
    },
    setCapture: (capture: typeof captureOverride) => {
      captureOverride = capture
    },
    /** Hold the display preparation of the nth exposure until released. */
    holdDisplay: (exposure: number) => {
      const held = deferred<void>()
      heldDisplays.set(exposure, held)

      return held.resolve
    },
  }
}

it('takes every exposure of a run, the view and the run record from the chosen exposure', async () => {
  const run = vi.fn<NonNullable<Parameters<typeof setup>[0]>>(async () => undefined)
  const subject = setup(run)
  await subject.controller.start('sim', 'Simulator', undefined, 5)
  expect(subject.controller.snapshot().exposureSeconds).toBe(5)
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ exposureSeconds: 5 }))

  for (let position = 0; position < 6; position++) subject.solve(await subject.nextSolve())
  await vi.waitFor(() => expect(subject.controller.snapshot().measurement).not.toBeNull())
  cadence.waits.shift()!()
  await subject.nextSolve()
  expect(subject.requestedExposures).toEqual(Array(7).fill(5))
  await subject.controller.stop()

  await subject.controller.start('sim', 'Simulator')
  await subject.nextSolve()
  expect(subject.requestedExposures.at(-1)).toBe(1)
  expect(subject.controller.snapshot().exposureSeconds).toBe(1)
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ exposureSeconds: 1 }))
})

it('rejects another start while acquisition remains active', async () => {
  const subject = setup()
  await subject.controller.start('sim', 'Simulator')
  await subject.nextSolve()
  await expect(subject.controller.start('other', 'Other rig')).rejects.toThrow('already running')
  expect(subject.controller.snapshot()).toMatchObject({
    rigId: 'sim',
    active: true,
    activity: 'solving',
  })
  expect(subject.exposures()).toBe(1)
})

it('publishes a baseline image after its solve attempt, including no-solution, and preserves it through stop', async () => {
  const subject = setup()
  await subject.controller.start('sim', 'Simulator')
  const request = await subject.nextSolve()
  // Display preparation waits for the solve so it cannot delay a correction.
  await Promise.resolve()
  expect(subject.controller.snapshot().preview).toBeNull()
  request.result.resolve({ status: 'no-solution', reasons: ['no-match'] })
  await vi.waitFor(() => expect(subject.controller.snapshot().preview).toBeTruthy())
  const preview = subject.controller.snapshot().preview!
  expect(preview).toMatchObject({
    capturedAt: request.frame.capturedAt,
    position: 1,
    imageWidth: 4,
    imageHeight: 4,
  })
  expect(subject.controller.snapshot().measurement).toBeNull()
  expect(subject.controller.snapshot().measuredAt).toBeNull()
  const id = preview.imageUrl.split('/').at(-1)!
  expect((await subject.controller.image(id, 'native'))?.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )
  expect(subject.controller.snapshot().preview).toBe(preview)
  await subject.controller.stop()
  expect(subject.controller.snapshot()).toMatchObject({
    phase: 'stopped',
    preview,
    measurement: null,
  })
})

it('does not use a solve the verdict rejects: each position is dropped and the run stops with the reasons', async () => {
  const journal = recording()

  const subject = setup(
    async () => journal,
    astapReturning(falseSolve({ raDegrees: 10, decDegrees: 60 }, { width: 4, height: 4 })),
  )

  await subject.controller.start('sim', 'Simulator')
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', solvedPositions: 0, measurement: null })
  expect(subject.controller.snapshot().error).toContain('Only 0 of 6')
  expect(subject.controller.snapshot().error).toContain('the image is mirrored')
  expect(subject.controller.snapshot().error).toContain('degrees from where the mount points')
  expect(journal.recordFrame).not.toHaveBeenCalled()
  expect(journal.recordRejected).toHaveBeenCalledTimes(2)
  expect(journal.recordRejected.mock.calls.map(([, position]) => position)).toEqual([1, 2])
  expect(subject.exposures()).toBe(2)
})

it('takes six fixes in five equal moves from RA 12 to 48 and fits the polar axis to them', async () => {
  const subject = setup()
  expect(subject.rightAscension()).toBe(10)
  await subject.baseline()
  expect(subject.exposures()).toBe(6)
  expect(subject.moves()).toBe(6)
  expect(subject.rightAscension()).toBeCloseTo(48)
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'adjusting', solvedPositions: 6, rigidity: null })
})

it('drops a fix that did not solve without exposing again, and fits the other five', async () => {
  const journal = recording()
  const subject = setup(async () => journal)
  await subject.sweep([3])
  await vi.waitFor(() => expect(subject.controller.snapshot().phase).toBe('adjusting'))
  expect(journal.recordRejected).toHaveBeenCalledExactlyOnceWith(expect.anything(), 3, expect.objectContaining({ reasons: ['no-match'] }), expect.anything())
  expect(journal.recordFit.mock.calls[0]![0].map(fix => fix.position)).toEqual([1, 2, 4, 5, 6])
  expect(subject.exposures()).toBe(6)
  expect(subject.controller.snapshot()).toMatchObject({
    solvedPositions: 5,
    rigidity: null,
    dropped: [{ position: 3, detail: 'Plate-solving failed (no star pattern matched)' }],
  })
})

it('stops with the reason once fewer than five fixes are possible', async () => {
  const subject = setup()
  await subject.controller.start('sim', 'Simulator')
  subject.solve(await subject.nextSolve())

  for (let position = 2; position <= 3; position++)
    (await subject.nextSolve()).result.resolve({ status: 'no-solution', reasons: ['no-match'] })
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', measurement: null })
  expect(subject.controller.snapshot().error).toBe(
    'Only 1 of 6 sweep positions gave a usable fix and the polar fit needs 5. Position 2: Plate-solving failed (no star pattern matched). Position 3: Plate-solving failed (no star pattern matched).',
  )
  expect(subject.exposures()).toBe(3)
})

it('stops when the last position gives no fix, because the adjusting baseline needs a frame where the mount now points', async () => {
  const subject = setup()
  await subject.sweep([6])
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', measurement: null })
  expect(subject.controller.snapshot().error).toContain('The last sweep position gave no fix')
  expect(subject.exposures()).toBe(6)
})

it('drops a position whose exposure failed safely and does not expose again', async () => {
  const subject = setup()
  const original = vi.fn()
  subject.setCapture(async () => {
    original()
    throw new CaptureRetryableError(new EquipmentError('Camera did not start', { reason: 'transport', endpoint: '/camera' }))
  })
  await subject.controller.start('sim', 'Simulator')
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  expect(subject.controller.snapshot().error).toContain('The exposure failed (Camera did not start)')
  expect(original).toHaveBeenCalledTimes(2)
})

it('reports not rigid with the miss and the step, and no polar error, when the camera slipped during the sweep', async () => {
  const journal = recording()
  const subject = setup(async () => journal)
  await subject.controller.start('sim', 'Simulator')

  for (let position = 1; position <= 6; position++) subject.solve(await subject.nextSolve(), 60, position >= 4 ? 1 : 0)
  await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
  const view = subject.controller.snapshot()
  expect(view).toMatchObject({
    phase: 'not-rigid',
    activity: 'idle',
    solvedPositions: 6,
    error: null,
    warning: null,
    measurement: null,
    rigidity: { thresholdArcmin: 2, steps: [{ beforePosition: 3, afterPosition: 4 }] },
  })
  expect(view.rigidity!.missArcmin).toBeGreaterThan(2)
  expect(journal.recordFit.mock.calls[0]![2].verdict.status).toBe('not-rigid')
  expect(journal.recordMeasurement).not.toHaveBeenCalled()
  expect(subject.exposures()).toBe(6)
})

it('keeps the solved image retrievable after repeated failed adjustment images', async () => {
  const subject = setup()
  await subject.baseline()
  const measurement = subject.controller.snapshot().measurement!
  const id = measurement.imageUrl.split('/').at(-1)!
  const image = await subject.controller.image(id, 'native')

  for (let attempt = 0; attempt < 6; attempt++) {
    cadence.waits.shift()!()
    const request = await subject.nextSolve()
    request.result.resolve({ status: 'no-solution', reasons: ['no-match'] })
    await vi.waitFor(() => expect(cadence.waits).toHaveLength(1))
  }

  expect(subject.controller.snapshot().measurement).toBe(measurement)
  expect(await subject.controller.image(id, 'native')).toBe(image)
})

it.each([false, true])(
  'waits for exposure cleanup before stopping and preserves cleanup failure=%s',
  async failCleanup => {
    const subject = setup()
    const cleanup = deferred<AlpacaFrame>()
    let aborted = false
    subject.setCapture(signal => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true
        },
        { once: true },
      )

      return cleanup.promise
    })
    await subject.controller.start('sim', 'Simulator')
    await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('exposing'))
    const stop = subject.controller.stop()
    let settled = false
    void stop.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(aborted).toBe(true)
    expect(settled).toBe(false)
    expect(subject.controller.snapshot()).toMatchObject({ active: true, activity: 'stopping' })
    cleanup.reject(
      failCleanup
        ? new Error('Camera did not confirm exposure stopped')
        : new DOMException('Stopped', 'AbortError'),
    )
    const result = await stop
    expect(result.active).toBe(false)
    expect(result.phase).toBe(failCleanup ? 'failed' : 'stopped')
    expect(result.error).toBe(failCleanup ? 'Camera did not confirm exposure stopped' : null)
  },
)

it('publishes image and readings together only after a solve, retaining the last good result through retries', async () => {
  const subject = setup()
  await subject.baseline()
  const previous = subject.controller.snapshot()
  expect(previous.phase).toBe('adjusting')
  expect(previous.measurement!.totalArcsec).toBeLessThan(0.001)
  const previousImageId = previous.measurement!.imageUrl.split('/').at(-1)!
  expect((await subject.controller.image(previousImageId, 'native'))?.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  )

  cadence.waits.shift()!()
  const blank = await subject.nextSolve()
  expect(subject.controller.snapshot().measurement).toBe(previous.measurement)
  blank.result.resolve({ status: 'no-solution', reasons: ['no-match'] })
  await vi.waitFor(() =>
    expect(subject.controller.snapshot().warning).toContain('Plate-solving failed'),
  )
  expect(subject.controller.snapshot()).toMatchObject({
    measuredAt: previous.measuredAt,
    measurement: previous.measurement,
  })
  cadence.waits.shift()!()
  const fresh = await subject.nextSolve()
  expect(subject.controller.snapshot().measurement).toBe(previous.measurement)
  subject.solve(fresh, 59.99)
  await vi.waitFor(() =>
    expect(subject.controller.snapshot().measuredAt).toBe(fresh.frame.capturedAt),
  )
  const updated = subject.controller.snapshot()
  expect(updated.warning).toBeNull()
  expect(updated.measurement!.totalArcsec).toBeGreaterThan(1)
  expect(updated.measurement!.imageUrl).not.toBe(previous.measurement!.imageUrl)
  expect(
    await subject.controller.image(updated.measurement!.imageUrl.split('/').at(-1)!, 'fit'),
  ).toBeDefined()

  cadence.waits.shift()!()
  const secondBlank = await subject.nextSolve()
  secondBlank.result.resolve({ status: 'no-solution', reasons: ['no-match'] })
  await vi.waitFor(() =>
    expect(subject.controller.snapshot().warning).toContain('Plate-solving failed'),
  )
  const count = subject.exposures()
  await subject.controller.stop()
  expect(subject.controller.snapshot()).toMatchObject({
    active: false,
    phase: 'stopped',
    measurement: updated.measurement,
  })
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
  expect(subject.controller.snapshot()).toMatchObject({
    phase: 'failed',
    measurement: previous.measurement,
    measuredAt: previous.measuredAt,
  })
  expect(subject.controller.snapshot().error).toContain('rig clock or simulator baseline changed')
  expect(cadence.waits).toHaveLength(0)
})

it.each([
  { ra: 30, dec: 60, frame: 'other' as const },
  { ra: 30, dec: 60, frame: 'topocentric' as const },
  { ra: 30, dec: -14, frame: 'j2000' as const },
  { ra: 274, dec: 60, frame: 'j2000' as const },
])(
  'requires the declared simulator frame and reset alignment position before moving: %j',
  async position => {
    const subject = setup()
    subject.setPointing(position)
    await subject.controller.start('sim', 'Simulator')
    await vi.waitFor(() => expect(subject.controller.snapshot().active).toBe(false))
    expect(subject.controller.snapshot().phase).toBe('failed')
    expect(subject.exposures()).toBe(0)
    expect(subject.moves()).toBe(0)
  },
)

it('publishes a correction before its display is ready, and image requests wait for that exposure', async () => {
  const subject = setup()
  await subject.baseline()
  const previous = subject.controller.snapshot()
  const release = subject.holdDisplay(7)

  cadence.waits.shift()!()
  const fresh = await subject.nextSolve()
  subject.solve(fresh, 59.99)
  await vi.waitFor(() =>
    expect(subject.controller.snapshot().measuredAt).toBe(fresh.frame.capturedAt),
  )
  const published = subject.controller.snapshot()
  const frameId = published.measurement!.frameId
  expect(frameId).not.toBe(previous.measurement!.frameId)
  expect(published.measurement!.solvedAt).toEqual(expect.any(String))
  // The preview still belongs to the earlier exposure; its images keep their own identity.
  expect(published.preview!.frameId).toBe(previous.preview!.frameId)

  let fit: Buffer | undefined

  const request = subject.controller.image(frameId, 'fit').then(image => {
    fit = image
  })

  await Promise.resolve()
  expect(fit).toBeUndefined()
  release()
  await request
  expect([...fit!.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  await vi.waitFor(() => expect(subject.controller.snapshot().preview!.frameId).toBe(frameId))
})

it('never lets an older exposure’s late display replace a newer preview', async () => {
  const subject = setup()
  await subject.baseline()
  const release = subject.holdDisplay(7)

  cadence.waits.shift()!()
  subject.solve(await subject.nextSolve(), 59.99)
  await vi.waitFor(() => expect(cadence.waits).toHaveLength(1))
  const older = subject.controller.snapshot().measurement!.frameId

  cadence.waits.shift()!()
  subject.solve(await subject.nextSolve(), 59.98)
  await vi.waitFor(() => expect(subject.controller.snapshot().measurement!.frameId).not.toBe(older))
  const newer = subject.controller.snapshot().measurement!.frameId
  await vi.waitFor(() => expect(subject.controller.snapshot().preview!.frameId).toBe(newer))

  release()
  expect(await subject.controller.image(older, 'fit')).toBeDefined()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(subject.controller.snapshot().preview!.frameId).toBe(newer)
})

it('stops an unpublished exposure’s display preparation with the run, leaving no late preview', async () => {
  const subject = setup()
  await subject.baseline()
  const previous = subject.controller.snapshot()
  subject.holdDisplay(7)

  cadence.waits.shift()!()
  // A sidereal reset fails this frame after its solve, so its correction is never published.
  subject.resetSidereal()
  subject.solve(await subject.nextSolve(), 59.99)
  await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({
    phase: 'failed',
    measurement: previous.measurement,
    preview: previous.preview,
  })
})

it('labels each baseline preview with the position it was captured at, even after the run moves on', async () => {
  const subject = setup()
  const release = subject.holdDisplay(1)
  await subject.controller.start('sim', 'Simulator')
  subject.solve(await subject.nextSolve())
  await vi.waitFor(() => expect(subject.controller.snapshot().position).toBe(2))
  release()
  await vi.waitFor(() => expect(subject.controller.snapshot().preview).toBeTruthy())
  expect(subject.controller.snapshot().preview!.position).toBe(1)
})
