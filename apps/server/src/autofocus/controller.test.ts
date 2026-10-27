import { afterEach, expect, it, vi } from 'vitest'
import {
  AutofocusStoppedError,
  createAutofocusController,
  type AutofocusCamera,
  type AutofocusFocuser,
  type AutofocusRecord,
} from './controller.js'
import type { AutofocusStar } from '@vela/model/web'
import { recordedRuns } from './fixtures/recorded-runs.js'
import { hyperbola } from './hyperbola.js'
import { APPROACH_OVERSHOOT_STEPS } from './walk.js'

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

function setup(
  start = 32842,
  maxStep = 60000,
  {
    holdMoves = false,
    holdFinalMeasurement = false,
    backlash = 0,
    hfrAt = (optical: number) => hyperbola(optical, 2.18, 95, 32838),
    starsAt,
    detectedAt = () => 40,
    record,
  }: {
    holdMoves?: boolean
    holdFinalMeasurement?: boolean
    backlash?: number
    hfrAt?: (optical: number) => number
    starsAt?: (position: number) => AutofocusStar[]
    detectedAt?: (position: number) => number
    record?: AutofocusRecord
  } = {},
) {
  let position = start
  let lag = 0
  const moves: number[] = []

  const captures: Array<
    ReturnType<typeof deferred<void>> &
      Parameters<AutofocusCamera['capture']>[0] & { position: number }
  > = []

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

      lag = Math.min(0, Math.max(-backlash, lag - (target - position)))
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

      const found = {
        algorithm: { version: 2 },
        detectedStars: detectedAt(position),
        medianHfrPixels: hfrAt(position + lag),
      }

      return starsAt ? { ...found, stars: starsAt(position) } : found
    },
    record,
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
    optical: () => position + lag,
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
  expect(controller.snapshot()).toMatchObject({
    active: true,
    activity: 'stopping',
    captureReadState: 'current',
  })
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
  const { controller, camera, focuser, land, moves, finalMeasurement, measuringFinal } = setup(
    32842,
    60000,
    { holdFinalMeasurement: true },
  )

  await controller.start(camera, focuser)

  for (let count = 0; count < 10; count++) await land()

  await measuringFinal.promise
  expect(controller.snapshot()).toMatchObject({
    phase: 'confirming',
    activity: 'measuring',
    active: true,
  })
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
  const { controller, camera, focuser, land, arrive, moves } = setup(32842, 60000, {
    holdMoves: true,
  })

  await controller.start(camera, focuser, { stepSize: 50, offsetSteps: 4, exposureSeconds: 2 })
  expect(controller.snapshot()).toMatchObject({
    active: true,
    startPosition: 32842,
    phase: 'walking',
    samples: [],
  })

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

const starsAt = (position: number): AutofocusStar[] => [
  { x: 120.5, y: 80, snr: 900, hfr: position / 10000 },
  { x: 40, y: 300.2, snr: 150.5, hfr: position / 9000 },
]

it('keeps each sample\'s star table beside the view and records the run once when it settles', async () => {
  const recorded = vi.fn()
  const { controller, camera, focuser, land } = setup(32842, 60000, { starsAt, record: recorded })

  expect(controller.run()).toBeNull()
  await controller.start(camera, focuser)

  for (let count = 0; count < 10; count++) await land()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const view = controller.snapshot()
  const run = controller.run()!

  expect(view.samples.every(sample => !('stars' in sample))).toBe(true)
  expect(run).toMatchObject({
    version: 1,
    rigId: 'fra',
    startedAt: '2026-09-17T00:00:00.000Z',
    settledAt: '2026-09-17T00:00:00.000Z',
    phase: 'complete',
    error: null,
    startPosition: 32842,
    stepSize: 50,
    offsetSteps: 4,
    exposureSeconds: 2,
    fit: view.fit,
  })
  expect(run.samples).toEqual(
    view.samples.map(sample => ({ ...sample, stars: starsAt(sample.position) })),
  )
  expect(run.samples).toHaveLength(10)
  expect(recorded).toHaveBeenCalledExactlyOnceWith(run)
})

it('records a stopped run with the samples it had', async () => {
  const recorded = vi.fn()
  const { controller, camera, focuser, land } = setup(32842, 60000, { starsAt, record: recorded })

  await controller.start(camera, focuser)
  await land()
  await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(1))
  expect(controller.run()).toMatchObject({ settledAt: null, phase: 'walking' })
  await controller.stop()

  expect(recorded).toHaveBeenCalledOnce()
  expect(recorded.mock.calls[0]![0]).toMatchObject({ phase: 'stopped', fit: null })
  expect(recorded.mock.calls[0]![0].samples).toHaveLength(1)
})

it('records nothing for a run that took no sample', async () => {
  const recorded = vi.fn()
  const { controller, camera, focuser } = setup(80, 60000, { record: recorded })

  await controller.start(camera, focuser)
  expect(controller.run()).toBeNull()
  expect(recorded).not.toHaveBeenCalled()
})

it('reads a sample measured without a star table as an empty one', async () => {
  const { controller, camera, focuser, land } = setup()

  await controller.start(camera, focuser)
  await land()
  await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(1))
  expect(controller.run()!.samples[0]!.stars).toEqual([])
})

it('walks and fits the same whether or not the measurement lists its stars', async () => {
  const outcome = async (withStars: boolean) => {
    const { controller, camera, focuser, land } = setup(32842, 60000, withStars ? { starsAt } : {})

    await controller.start(camera, focuser)

    for (let count = 0; count < 10; count++) await land()

    await vi.waitFor(() => expect(controller.active()).toBe(false))
    const { samples, fit, finalApproach, phase } = controller.snapshot()

    return { samples, fit, finalApproach, phase }
  }

  expect(await outcome(true)).toEqual(await outcome(false))
})

it('restores the start position on cancel and never commands 0', async () => {
  const { controller, camera, focuser, land, moves } = setup()
  await controller.start(camera, focuser)
  await land()
  await land()
  await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(2))
  await controller.stop()
  expect(controller.snapshot()).toMatchObject({
    phase: 'stopped',
    startPosition: 32842,
    currentPosition: 32842,
    restoredStart: true,
  })
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
  expect(controller.snapshot()).toMatchObject({
    captureReadState: 'current',
    activity: 'exposing',
    samples: prior,
    exposureStartedAt,
  })
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
  expect(view.error).toMatch(/leave the focuser travel/)
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
  expect(view.error).toBe('The focuser is outside the reported travel window. Vela will not move.')
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

const backlash = 150

it('lands on best focus from above, taking up the backlash the way the samples saw it', async () => {
  const { controller, camera, focuser, land, moves, optical } = setup(32842, 60000, { backlash })
  await controller.start(camera, focuser)

  for (let count = 0; count < 10; count++) await land()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const view = controller.snapshot()
  const target = view.fit!.position
  expect(view.phase).toBe('complete')
  expect(moves.slice(-2)).toEqual([target + APPROACH_OVERSHOOT_STEPS, target])
  expect(optical()).toBe(target)
  expect(view.currentPosition).toBe(target)
  expect(view.finalApproach).toEqual({
    purpose: 'best-focus',
    target,
    via: target + APPROACH_OVERSHOOT_STEPS,
  })
})

it('would land short of best focus by the backlash if the last move came up from below', async () => {
  const { focuser, optical } = setup(32842, 60000, { backlash })
  const window = { minPosition: 1, maxPosition: 60000 }
  await focuser.move(32700, window)
  await focuser.move(32900, window)
  expect(optical()).toBe(32900 - backlash)
  await focuser.move(32900 + APPROACH_OVERSHOOT_STEPS, window)
  await focuser.move(32900, window)
  expect(optical()).toBe(32900)
})

it('returns to the start from above after a failed fit', async () => {
  const { controller, camera, focuser, land, moves, optical } = setup(32842, 60000, {
    backlash,
    hfrAt: () => 5,
  })

  await controller.start(camera, focuser)

  for (let count = 0; count < 9; count++) await land()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    restoredStart: true,
    currentPosition: 32842,
    finalApproach: { purpose: 'restore-start', target: 32842, via: 32842 + APPROACH_OVERSHOOT_STEPS },
  })
  expect(moves.slice(-2)).toEqual([32842 + APPROACH_OVERSHOOT_STEPS, 32842])
  expect(optical()).toBe(32842)
})

it('returns to the start from above after Stop below the start', async () => {
  const { controller, camera, focuser, land, moves, optical } = setup(32842, 60000, { backlash })
  await controller.start(camera, focuser)

  for (let count = 0; count < 7; count++) await land()

  await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(7))
  expect(controller.snapshot().currentPosition).toBeLessThan(32842)
  await controller.stop()
  expect(controller.snapshot()).toMatchObject({
    phase: 'stopped',
    restoredStart: true,
    finalApproach: { purpose: 'restore-start', target: 32842, via: 32842 + APPROACH_OVERSHOOT_STEPS },
  })
  expect(moves.slice(-2)).toEqual([32842 + APPROACH_OVERSHOOT_STEPS, 32842])
  expect(optical()).toBe(32842)
})

it('shortens the overshoot to stay inside the focuser travel', async () => {
  const { controller, camera, focuser, land, moves } = setup(32842, 33100, { hfrAt: () => 5 })
  await controller.start(camera, focuser)

  for (let count = 0; count < 9; count++) await land()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(moves.slice(-2)).toEqual([33099, 32842])
  expect(controller.snapshot().finalApproach).toMatchObject({ target: 32842, via: 33099 })
})

it.each(recordedRuns)(
  'replays the run recorded from $startPosition and lands on its floor with a fit well clear of the gate',
  async run => {
    const recorded = new Map(run.samples.map(sample => [sample.position, sample]))

    const { controller, camera, focuser, land } = setup(run.startPosition, 60000, {
      hfrAt: position => recorded.get(position)?.hfrPixels ?? run.confirming.hfrPixels,
      starsAt: position => recorded.get(position)?.stars ?? [],
      detectedAt: position => recorded.get(position)?.detectedStars ?? 10,
    })

    await controller.start(camera, focuser)

    for (let count = 0; count < 10; count++) await land()

    await vi.waitFor(() => expect(controller.active()).toBe(false))
    const view = controller.snapshot()
    const lowest = view.fit!.minSamplePosition

    expect(view.phase).toBe('complete')
    expect(Math.abs(view.fit!.position - lowest)).toBeLessThan(view.stepSize)
    expect(view.fit!.rSquared).toBeGreaterThan(0.95)
  },
)
