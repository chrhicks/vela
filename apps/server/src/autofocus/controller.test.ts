import { afterEach, expect, it, vi } from 'vitest'
import { AutofocusStoppedError, createAutofocusController, type AutofocusCamera, type AutofocusFocuser } from './controller.js'
import { hyperbola } from './hyperbola.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void

  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

const stops: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(stops.splice(0).map(stop => stop()))
})

function setup(start = 32842, maxStep = 60000, { holdMoves = false, holdFinalMeasurement = false } = {}) {
  let position = start
  const moves: number[] = []
  const captures: Array<ReturnType<typeof deferred<void>> & Parameters<AutofocusCamera['capture']>[0] & { position: number }> = []
  const pendingMoves: Array<ReturnType<typeof deferred<void>> & { target: number }> = []
  const finalMeasurement = deferred<void>()
  const measuringFinal = deferred<void>()

  const focuser: AutofocusFocuser = {
    async status() {
      return { absolute: true, position, maxStep, moving: false }
    },
    async move(target, window) {
      expect(target).not.toBe(0)
      expect(target).toBeGreaterThanOrEqual(Math.max(1, window.minPosition))
      expect(target).toBeLessThan(maxStep)
      expect(target).toBeLessThanOrEqual(window.maxPosition)

      if (holdMoves) {
        const gate = deferred<void>()
        pendingMoves.push({ target, ...gate })
        await gate.promise
      }

      position = target
      moves.push(target)

      return { position }
    },
    async halt() {},
  }

  const camera: AutofocusCamera = {
    async capture(input) {
      const { signal, onProgress } = input
      onProgress(0.2)
      const gate = deferred<void>()
      captures.push({ position, ...input, ...gate })
      const abort = () => gate.reject(new AutofocusStoppedError())
      signal.addEventListener('abort', abort, { once: true })
      await gate.promise.finally(() => signal.removeEventListener('abort', abort))

      return {
        width: 8,
        height: 8,
        pixels: new Float64Array(64),
        capturedAt: '2026-09-17T00:00:00.000Z',
        color: { kind: 'mono' as const },
      }
    },
  }

  const controller = createAutofocusController(
    { rigId: 'fra', rigName: 'FRA 400', cameraName: 'ASI2600', focuserName: 'EAF' },
    () => Date.parse('2026-09-17T00:00:00Z'),
    async () => {
      if (holdFinalMeasurement && controller.snapshot().phase === 'confirming') {
        measuringFinal.resolve()
        await finalMeasurement.promise
      }

      return { detectedStars: 40, medianHfrPixels: hyperbola(position, 2.18, 95, 32838) }
    },
  )

  async function land() {
    await vi.waitFor(() => expect(captures.length).toBeGreaterThan(0))
    captures.shift()!.resolve()
  }

  async function arrive() {
    await vi.waitFor(() => expect(pendingMoves.length).toBeGreaterThan(0))
    pendingMoves.shift()!.resolve()
  }

  stops.push(async () => {
    finalMeasurement.resolve()

    while (pendingMoves.length) pendingMoves.shift()!.resolve()

    while (captures.length) captures.shift()!.resolve()
    await controller.stop()
  })

  return {
    controller,
    focuser,
    camera,
    moves,
    land,
    arrive,
    captures,
    finalMeasurement,
    measuringFinal,
    position: () => position,
  }
}

it.each([
  new Error('Camera abort failed; idle could not be confirmed'),
  Object.assign(new Error('Camera cleanup timed out'), { name: 'AbortError' }),
])('preserves a camera cleanup failure after Stop: $message', async failure => {
  const { controller, focuser, moves } = setup()
  const exposing = deferred<Parameters<AutofocusCamera['capture']>[0]>()
  const cleanup = deferred<never>()
  const released = vi.fn()

  const camera: AutofocusCamera = {
    async capture(input) {
      exposing.resolve(input)

      return cleanup.promise
    },
  }

  await controller.start(camera, focuser, { onSettled: released })
  const pending = await exposing.promise
  pending.onReadState('retrying')
  const stopping = controller.stop()
  pending.onReadState('retrying')
  expect(controller.snapshot()).toMatchObject({ active: true, activity: 'stopping', captureReadState: 'current' })
  expect(released).not.toHaveBeenCalled()
  cleanup.reject(failure)
  await stopping
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    active: false,
    currentPosition: 32842,
    restoredStart: true,
    error: failure.message,
    captureReadState: 'current',
  })
  expect(moves.at(-1)).toBe(32842)
  expect(released).toHaveBeenCalledOnce()
})

it('restores start when Stop arrives while the final confirmation measurement is pending', async () => {
  const {
    controller,
    camera,
    focuser,
    land,
    moves,
    finalMeasurement,
    measuringFinal,
  } = setup(32842, 60000, { holdFinalMeasurement: true })

  await controller.start(camera, focuser)

  for (let count = 0; count < 10; count++) await land()

  await measuringFinal.promise
  expect(controller.snapshot()).toMatchObject({ phase: 'confirming', activity: 'measuring', active: true })
  expect(controller.snapshot().currentPosition).not.toBe(32842)
  const stopping = controller.stop()
  expect(controller.snapshot()).toMatchObject({ activity: 'stopping', active: true })
  finalMeasurement.resolve()
  await stopping
  expect(controller.snapshot()).toMatchObject({
    phase: 'stopped',
    active: false,
    currentPosition: 32842,
    restoredStart: true,
    error: null,
  })
  expect(moves.at(-1)).toBe(32842)
})

it('lands each (position, HFR) sample on the view before the next move, then fits a hyperbola', async () => {
  const { controller, camera, focuser, land, arrive, moves } = setup(32842, 60000, { holdMoves: true })
  await controller.start(camera, focuser, { stepSize: 50, offsetSteps: 4, exposureSeconds: 2 })
  expect(controller.snapshot()).toMatchObject({ active: true, startPosition: 32842, phase: 'walking', samples: [] })

  for (let count = 1; count <= 9; count++) {
    await arrive()
    await land()
    await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(count))
    const view = controller.snapshot()
    expect(view.samples.at(-1)?.position).toBe(view.currentPosition)
    expect(view.samples.at(-1)?.hfrPixels).toBeGreaterThan(0)

    if (count < 9) expect(view.fit).toBeNull()
  }

  await vi.waitFor(() => expect(controller.snapshot().fit).not.toBeNull())
  await arrive()
  await land()
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const view = controller.snapshot()
  expect(view.phase).toBe('complete')
  expect(view.startPosition).toBe(32842)
  expect(view.fit).toMatchObject({ minSamplePosition: 32842 })
  expect(view.fit!.position).not.toBe(0)
  expect(view.fit!.position).toBeGreaterThan(32642)
  expect(view.fit!.position).toBeLessThan(33042)
  expect(moves[0]).toBe(33042)
  expect(moves).not.toContain(0)
  expect(view.restoredStart).toBe(false)
})

it('restores the start position on cancel and never commands 0', async () => {
  const { controller, camera, focuser, land, moves } = setup()
  await controller.start(camera, focuser)
  await land()
  await land()
  await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(2))
  await controller.stop()
  expect(controller.snapshot()).toMatchObject({ phase: 'stopped', startPosition: 32842, currentPosition: 32842, restoredStart: true })
  expect(moves.at(-1)).toBe(32842)
  expect(moves).not.toContain(0)
})

it('holds the current sample and lease through read recovery, then restores start when stopped during another interruption', async () => {
  const { controller, camera, focuser, land, captures, moves } = setup()
  const released = vi.fn()
  await controller.start(camera, focuser, { onSettled: released })
  await land()
  await vi.waitFor(() => expect(captures).toHaveLength(1))
  const prior = controller.snapshot().samples
  expect(prior).toHaveLength(1)
  const pending = captures[0]!
  const exposureStartedAt = controller.snapshot().exposureStartedAt
  pending.onReadState('retrying')
  expect(controller.snapshot()).toMatchObject({
    active: true,
    phase: 'walking',
    activity: 'exposing',
    captureReadState: 'retrying',
    samples: prior,
    exposureStartedAt,
  })
  expect(released).not.toHaveBeenCalled()
  pending.onReadState('current')
  expect(controller.snapshot()).toMatchObject({ captureReadState: 'current', activity: 'exposing', samples: prior, exposureStartedAt })
  expect(captures).toHaveLength(1)
  await land()
  await vi.waitFor(() => expect(captures).toHaveLength(1))
  expect(controller.snapshot().samples).toHaveLength(2)
  pending.onReadState('retrying')
  pending.onProgress(99)
  expect(controller.snapshot()).toMatchObject({ captureReadState: 'current', elapsedSeconds: 0.2 })
  const last = captures[0]!
  last.onReadState('retrying')
  const stopped = controller.stop()
  last.onReadState('retrying')
  expect(controller.snapshot()).toMatchObject({ activity: 'stopping', captureReadState: 'current' })
  await stopped
  last.onReadState('retrying')
  expect(controller.snapshot()).toMatchObject({
    active: false,
    phase: 'stopped',
    captureReadState: 'current',
    currentPosition: 32842,
    restoredStart: true,
  })
  expect(controller.snapshot().samples).toHaveLength(2)
  expect(moves.at(-1)).toBe(32842)
  expect(released).toHaveBeenCalledOnce()
})

it('aborts a window that would approach 0 without moving', async () => {
  const { controller, camera, focuser, moves } = setup(80)
  const view = await controller.start(camera, focuser, { stepSize: 50, offsetSteps: 4 })
  expect(view).toMatchObject({
    phase: 'setup',
    active: false,
    startPosition: null,
    currentPosition: 80,
    restoredStart: false,
  })
  expect(view.error).toMatch(/MaxStep|0/)
  expect(moves).toEqual([])
})

it('reports a start at position 0 as setup with an error and does not command Move(0)', async () => {
  const { controller, camera, focuser, moves } = setup(0)
  const view = await controller.start(camera, focuser, { stepSize: 50, offsetSteps: 4 })
  expect(view).toMatchObject({
    phase: 'setup',
    active: false,
    startPosition: null,
    currentPosition: 0,
    restoredStart: false,
  })
  expect(view.error).toMatch(/mechanical limit/)
  expect(moves).toEqual([])
})

it('returns to setup when the focuser is not absolute, instead of leftover walking', async () => {
  const { controller, camera, focuser, moves } = setup()
  focuser.status = async () => ({ absolute: false, position: 32842, maxStep: 60000, moving: false })
  const view = await controller.start(camera, focuser)
  expect(view).toMatchObject({
    phase: 'setup',
    active: false,
    startPosition: null,
    currentPosition: 32842,
    restoredStart: false,
  })
  expect(view.error).toMatch(/absolute/)
  expect(moves).toEqual([])
})
