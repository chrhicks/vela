import { afterEach, expect, it, vi } from 'vitest'
import {
  AutofocusFocuserUncertainError,
  AutofocusStoppedError,
  createAutofocusController,
  type AutofocusCamera,
  type AutofocusFocuser,
  type AutofocusAirTemperature,
  type AutofocusRecord,
} from './controller.js'
import type { AutofocusStar } from '@vela/model/web'
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
    minStep,
    starless = false,
    confirmFactors = [],
    hfrAt = (optical: number) => hyperbola(optical, 2.18, 95, 32838),
    starsAt,
    record,
    airTemperature,
  }: {
    holdMoves?: boolean
    holdFinalMeasurement?: boolean
    backlash?: number
    minStep?: number
    /** No frame measures a star. */
    starless?: boolean
    /** Multiplies the HFR of the first confirm frames, in order. A frame past the list is not changed. */
    confirmFactors?: number[]
    hfrAt?: (optical: number) => number
    starsAt?: (position: number) => AutofocusStar[]
    record?: AutofocusRecord
    airTemperature?: AutofocusAirTemperature
  } = {},
) {
  let position = start
  let lag = 0
  let confirmFrames = 0
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
      const reported = { absolute: true, position, maxStep, moving: false }

      return minStep === undefined ? reported : { ...reported, minStep }
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

      if (starless) return { algorithm: { version: 2 }, detectedStars: 0, medianHfrPixels: null }

      const confirming = controller.snapshot().phase === 'confirming'
      const factor = confirming ? (confirmFactors[confirmFrames++] ?? 1) : 1

      const found = {
        algorithm: { version: 2 },
        detectedStars: 40,
        medianHfrPixels: hfrAt(position + lag) * factor,
      }

      return starsAt ? { ...found, stars: starsAt(position) } : found
    },
    record,
    airTemperature,
  )

  async function land() {
    await vi.waitFor(() => expect(captures.length).toBeGreaterThan(0))
    captures.shift()!.resolve()
  }

  async function arrive() {
    await vi.waitFor(() => expect(pendingMoves.length).toBeGreaterThan(0))
    pendingMoves.shift()!.resolve()
  }

  /** Lands every exposure the run asks for until it settles. */
  async function landUntilSettled() {
    while (controller.active()) {
      if (captures.length) captures.shift()!.resolve()
      else await new Promise(resolve => setImmediate(resolve))
    }
  }

  /** Lands exposures until `done` holds, then stops landing. */
  async function landUntil(done: () => boolean) {
    while (controller.active() && !done()) {
      if (captures.length) captures.shift()!.resolve()
      else await new Promise(resolve => setImmediate(resolve))
    }
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
    landUntilSettled,
    landUntil,
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
  const { controller, camera, focuser, landUntil, moves, finalMeasurement, measuringFinal } = setup(
    32842,
    60000,
    { holdFinalMeasurement: true },
  )

  let measuringConfirm = false
  void measuringFinal.promise.then(() => (measuringConfirm = true))
  await controller.start(camera, focuser)
  await landUntil(() => measuringConfirm)
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

it('walks a coarse pass, then a fine pass around its minimum, lands and confirms, one sample at a time', async () => {
  const { controller, camera, focuser, land, landUntilSettled, moves } = setup(32842, 60000)

  await controller.start(camera, focuser, { exposureSeconds: 2 })
  expect(controller.snapshot()).toMatchObject({
    active: true,
    startPosition: 32842,
    phase: 'walking',
    stepSize: 150,
    offsetSteps: 4,
    fineStepSize: 25,
    fineOffsetSteps: 6,
    confirmTolerance: 0.1,
    samples: [],
  })

  async function takeSample(count: number) {
    await land()
    await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(count))

    return controller.snapshot()
  }

  for (let count = 1; count <= 9; count++) {
    const view = await takeSample(count)
    expect(view.samples.at(-1)).toMatchObject({ pass: 'coarse', position: 33442 - (count - 1) * 150 })
    expect(view.samples.at(-1)?.hfrPixels).toBeGreaterThan(0)
    expect(view.fit).toBeNull()
  }

  for (let count = 10; count <= 22; count++) {
    const view = await takeSample(count)
    expect(view.samples.at(-1)).toMatchObject({ pass: 'fine', position: 32992 - (count - 10) * 25 })
  }

  await landUntilSettled()
  const view = controller.snapshot()
  expect(view.phase).toBe('complete')
  expect(view.startPosition).toBe(32842)
  expect(view.samples).toHaveLength(23)
  expect(view.samples[22]).toMatchObject({ pass: 'confirm', position: view.fit!.position })
  expect(view.fit).toMatchObject({ minSamplePosition: 32842 })
  expect(view.fit!.position).toBeGreaterThan(32792)
  expect(view.fit!.position).toBeLessThan(32892)
  expect(view.landing).toMatchObject({
    position: view.fit!.position,
    outcome: 'confirmed',
    bestSample: { position: 32842 },
    tolerance: 0.1,
    attempts: [{ source: 'fit', position: view.fit!.position, sampleIndex: 22, withinTolerance: true }],
  })
  expect(moves[0]).toBe(33442 + APPROACH_OVERSHOOT_STEPS)
  expect(moves[1]).toBe(33442)
  expect(moves).not.toContain(0)
  expect(view.restoredStart).toBe(false)
})

const starsAt = (position: number): AutofocusStar[] => [
  { x: 120.5, y: 80, snr: 900, hfr: position / 10000 },
  { x: 40, y: 300.2, snr: 150.5, hfr: position / 9000 },
]

it('keeps each sample\'s star table beside the view and records the run once when it settles', async () => {
  const recorded = vi.fn()
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, { starsAt, record: recorded })

  expect(controller.run()).toBeNull()
  await controller.start(camera, focuser)

  await landUntilSettled()

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
    stepSize: 150,
    offsetSteps: 4,
    fineStepSize: 25,
    fineOffsetSteps: 6,
    confirmTolerance: 0.1,
    travel: { min: 1, max: 59999 },
    exposureSeconds: 2,
    fit: view.fit,
    landing: view.landing,
  })
  expect(run.samples).toEqual(
    view.samples.map(sample => ({ ...sample, stars: starsAt(sample.position) })),
  )
  expect(run.samples).toHaveLength(23)
  expect(run.samples.map(sample => sample.pass)).toEqual([
    ...Array(9).fill('coarse'),
    ...Array(13).fill('fine'),
    'confirm',
  ])
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

it('records the air temperature given at the start and the one read when the run settles', async () => {
  const recorded = vi.fn()
  const read = vi.fn<AutofocusAirTemperature>(async () => 5.2)
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, { record: recorded, airTemperature: read })

  await controller.start(camera, focuser, { airTemperatureStartC: 4.7 })
  expect(read).not.toHaveBeenCalled()

  await landUntilSettled()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(read).toHaveBeenCalledOnce()
  expect(controller.run()!.airTemperatureC).toEqual({ start: 4.7, end: 5.2 })
  expect(recorded.mock.calls[0]![0].airTemperatureC).toEqual({ start: 4.7, end: 5.2 })
})

it('reads the end temperature for a stopped run', async () => {
  const recorded = vi.fn()
  const read = vi.fn<AutofocusAirTemperature>(async () => 8)
  const { controller, camera, focuser, land } = setup(32842, 60000, { record: recorded, airTemperature: read })

  await controller.start(camera, focuser, { airTemperatureStartC: 7.5 })
  await land()
  await vi.waitFor(() => expect(controller.snapshot().samples).toHaveLength(1))
  await controller.stop()

  expect(recorded.mock.calls[0]![0]).toMatchObject({ phase: 'stopped', airTemperatureC: { start: 7.5, end: 8 } })
})

it('leaves the end temperature null and still records the run when the read fails', async () => {
  const recorded = vi.fn()
  const read = vi.fn<AutofocusAirTemperature>().mockRejectedValue(new Error('Cria did not answer'))
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, { record: recorded, airTemperature: read })

  await controller.start(camera, focuser, { airTemperatureStartC: 4.7 })

  await landUntilSettled()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot().phase).toBe('complete')
  expect(recorded.mock.calls[0]![0].airTemperatureC).toEqual({ start: 4.7, end: null })
})

it('stops waiting for an end temperature that does not arrive', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

  const recorded = vi.fn()
  let abandoned: AbortSignal | undefined

  const read: AutofocusAirTemperature = signal => {
    abandoned = signal

    return new Promise(() => {})
  }

  const { controller, camera, focuser, landUntil } = setup(32842, 60000, { record: recorded, airTemperature: read })

  try {
    await controller.start(camera, focuser, { airTemperatureStartC: 4.7 })

    await landUntil(() => abandoned !== undefined)
    expect(recorded).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    expect(abandoned!.aborted).toBe(true)
    expect(recorded.mock.calls[0]![0].airTemperatureC).toEqual({ start: 4.7, end: null })
  } finally {
    vi.useRealTimers()
  }
})

it('does not read an end temperature for a run that took no sample', async () => {
  const read = vi.fn<AutofocusAirTemperature>(async () => 5)
  const { controller, camera, focuser } = setup(80, 60000, { airTemperature: read })

  await controller.start(camera, focuser)
  expect(read).not.toHaveBeenCalled()
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
    const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, withStars ? { starsAt } : {})

    await controller.start(camera, focuser)

    await landUntilSettled()

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
  const { controller, camera, focuser, landUntilSettled, moves, optical } = setup(32842, 60000, { backlash })
  await controller.start(camera, focuser)

  await landUntilSettled()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const view = controller.snapshot()
  const target = view.landing!.position
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

it('ends the run and sends no restore move when a focuser move ends uncertain', async () => {
  const { controller, camera, focuser, land, moves } = setup()
  const move = focuser.move.bind(focuser)
  let calls = 0

  focuser.move = async (target, window, signal) => {
    if (++calls === 3) throw new AutofocusFocuserUncertainError('The focuser never read back the target')

    return move(target, window, signal)
  }

  await controller.start(camera, focuser)
  await land()

  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', restoredStart: false })
  expect(controller.snapshot().error).toContain('The focuser never read back the target. Vela did not move the focuser again')
  expect(moves).toHaveLength(2)
})

it('returns to the start from above after a pass that measured no stars', async () => {
  const { controller, camera, focuser, landUntilSettled, moves, optical } = setup(32842, 60000, {
    backlash,
    starless: true,
  })

  await controller.start(camera, focuser)
  await landUntilSettled()
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    restoredStart: true,
    currentPosition: 32842,
    error: 'The coarse pass measured no stars. Returning to the start position.',
    finalApproach: { purpose: 'restore-start', target: 32842, via: 32842 + APPROACH_OVERSHOOT_STEPS },
  })
  expect(controller.snapshot().samples).toHaveLength(9)
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
  const { controller, camera, focuser, landUntilSettled, moves } = setup(32842, 33100, { starless: true })
  await controller.start(camera, focuser, { stepSize: 50 })
  await landUntilSettled()
  expect(moves.slice(-2)).toEqual([33099, 32842])
  expect(controller.snapshot().finalApproach).toMatchObject({ target: 32842, via: 33099 })
})

it('extends the coarse window toward lower HFR instead of failing when the minimum is past its edge', async () => {
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, {
    hfrAt: optical => hyperbola(optical, 2.18, 95, 32100),
  })

  await controller.start(camera, focuser)
  await landUntilSettled()

  const view = controller.snapshot()
  const coarse = view.samples.filter(sample => sample.pass === 'coarse').map(sample => sample.position)

  expect(view.phase).toBe('complete')
  expect(coarse.slice(0, 9)).toEqual([33442, 33292, 33142, 32992, 32842, 32692, 32542, 32392, 32242])
  expect(coarse.slice(9)).toEqual([32092, 31942])
  expect(Math.abs(view.landing!.position - 32100)).toBeLessThan(40)
  expect(view.landing!.outcome).toBe('confirmed')
})

it('extends the fine window toward lower HFR when its minimum is at the window edge', async () => {
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, {
    hfrAt: optical => hyperbola(optical, 2.18, 95, 32630),
  })

  await controller.start(camera, focuser, { fineOffsetSteps: 1 })
  await landUntilSettled()

  const view = controller.snapshot()
  const fine = view.samples.filter(sample => sample.pass === 'fine').map(sample => sample.position)

  expect(view.phase).toBe('complete')
  expect(fine).toEqual([32717, 32692, 32667, 32642, 32617])
  expect(Math.abs(view.landing!.position - 32630)).toBeLessThanOrEqual(25)
})

it('fails at the end of the focuser travel when HFR is still falling there, and restores the start', async () => {
  const { controller, camera, focuser, landUntilSettled, moves } = setup(32842, 60000, {
    minStep: 32000,
    hfrAt: optical => hyperbola(optical, 2.18, 95, 31000),
  })

  await controller.start(camera, focuser)
  await landUntilSettled()

  const view = controller.snapshot()
  expect(view).toMatchObject({ phase: 'failed', restoredStart: true, currentPosition: 32842 })
  expect(view.error).toMatch(/HFR was still falling at the low end of the focuser travel \(32092\)/)
  expect(view.samples.at(-1)!.position).toBe(32092)
  expect(Math.min(...moves)).toBeGreaterThanOrEqual(32000)
  expect(view.landing).toBeNull()
})

it('goes back to the best fine-pass sample, from above, when the confirm frame is more than 10 % worse', async () => {
  const { controller, camera, focuser, landUntilSettled, moves, optical } = setup(32842, 60000, {
    backlash,
    confirmFactors: [1.5],
  })

  await controller.start(camera, focuser)
  await landUntilSettled()

  const view = controller.snapshot()
  const confirms = view.samples.filter(sample => sample.pass === 'confirm')
  const fitted = view.fit!.position

  expect(view.phase).toBe('complete')
  expect(confirms.map(sample => sample.position)).toEqual([fitted, 32842])
  expect(view.landing).toMatchObject({
    position: 32842,
    outcome: 'fell-back',
    bestSample: { position: 32842 },
    attempts: [
      { source: 'fit', position: fitted, withinTolerance: false },
      { source: 'best-sample', position: 32842, withinTolerance: true },
    ],
  })
  expect(view.landing!.attempts.map(attempt => attempt.sampleIndex)).toEqual([22, 23])
  expect(moves.slice(-4)).toEqual([fitted + APPROACH_OVERSHOOT_STEPS, fitted, 32842 + APPROACH_OVERSHOOT_STEPS, 32842])
  expect(view.finalApproach).toEqual({ purpose: 'best-sample', target: 32842, via: 32842 + APPROACH_OVERSHOOT_STEPS })
  expect(view.currentPosition).toBe(32842)
  expect(optical()).toBe(32842)
})

it('says so when the fall-back frame is also worse than the best sample, and stays at the best sample', async () => {
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, { confirmFactors: [1.5, 1.5] })

  await controller.start(camera, focuser)
  await landUntilSettled()

  const view = controller.snapshot()
  expect(view.phase).toBe('complete')
  expect(view.landing).toMatchObject({ position: 32842, outcome: 'unconfirmed' })
  expect(view.landing!.attempts.map(attempt => attempt.withinTolerance)).toEqual([false, false])
})

it('accepts a confirm frame exactly at the tolerance and takes one confirm frame', async () => {
  const { controller, camera, focuser, landUntilSettled } = setup(32842, 60000, { confirmFactors: [1.09] })

  await controller.start(camera, focuser)
  await landUntilSettled()

  const view = controller.snapshot()
  expect(view.landing).toMatchObject({ outcome: 'confirmed' })
  expect(view.samples.filter(sample => sample.pass === 'confirm')).toHaveLength(1)
})

it.each([
  [{ fineStepSize: 0 }, /Fine step size/],
  [{ fineOffsetSteps: 11 }, /Fine offset steps/],
  [{ confirmTolerance: 0 }, /Confirm tolerance/],
  [{ confirmTolerance: 1.5 }, /Confirm tolerance/],
])('refuses %j before it moves', async (options, message) => {
  const { controller, camera, focuser, moves } = setup()

  await expect(controller.start(camera, focuser, options)).rejects.toThrow(message)
  expect(moves).toEqual([])
})
