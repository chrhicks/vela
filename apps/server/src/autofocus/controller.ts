import type {
  AutofocusApproach,
  AutofocusLanding,
  AutofocusLandingAttempt,
  AutofocusPass,
  AutofocusRun,
  AutofocusSample,
  AutofocusStar,
  AutofocusView,
  CaptureImageStatistics,
} from '@vela/model/web'
import type { CaptureFrame } from '../capture/controller.js'
import { measureAutofocusStars } from '../imaging/statistics.js'
import { chooseFocus, confirmsBest, type FocusChoice } from './choice.js'
import { nextInPass, planPass, type PassSettings } from './passes.js'
import {
  DEFAULT_CONFIRM_TOLERANCE,
  DEFAULT_FINE_OFFSET_STEPS,
  DEFAULT_FINE_STEP_SIZE,
  DEFAULT_OFFSET_STEPS,
  DEFAULT_STEP_SIZE,
  approachFromAbove,
  planStarHfrWalk,
  assertCommandedPosition,
  type FocuserTravel,
} from './walk.js'

// Device boundaries may report cancellation only after confirming cleanup.
export class AutofocusStoppedError extends Error {
  constructor() {
    super('Autofocus stopped')
    this.name = 'AutofocusStoppedError'
  }
}

/**
 * A focuser move whose outcome is unknown. Cria no longer holds the focuser, so nothing else
 * stops the run's restore move; the run ends instead and leaves the focuser where it is.
 */
export class AutofocusFocuserUncertainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutofocusFocuserUncertainError'
  }
}

export interface AutofocusFocuser {
  status(signal?: AbortSignal): Promise<{
    absolute: boolean
    position: number
    minStep?: number
    maxStep: number
    moving: boolean
  }>
  move(
    position: number,
    window: { minPosition: number; maxPosition: number },
    signal?: AbortSignal,
  ): Promise<{ position: number }>
  halt(): Promise<void>
}

export interface AutofocusCamera {
  capture(input: {
    exposureSeconds: number
    signal: AbortSignal
    onProgress: (elapsedSeconds: number) => void
    onReadState: (state: AutofocusView['captureReadState']) => void
  }): Promise<CaptureFrame>
}

export interface AutofocusRunOptions {
  /** The coarse pass: step, and steps on each side of the start. */
  stepSize?: number
  offsetSteps?: number
  /** The fine pass, centred on the coarse minimum. */
  fineStepSize?: number
  fineOffsetSteps?: number
  /** How much worse than the best fine-pass sample a confirm frame may be; 0.1 is 10 %. */
  confirmTolerance?: number
  exposureSeconds?: number
  /** The air temperature the caller already read when it checked the rig was ready. */
  airTemperatureStartC?: number | null
  onSettled?: () => void
}

/** The air temperature now, or null. It may reject; the controller treats that as null. */
export type AutofocusAirTemperature = (signal: AbortSignal) => Promise<number | null>

/** The end reading starts when the walk finishes and runs beside the restore, so this bounds only its tail. */
const airTemperatureTimeoutMs = 3000

/** The settings of one run, all read before its first move. */
interface RunSettings {
  stepSize: number
  offsetSteps: number
  fineStepSize: number
  fineOffsetSteps: number
  confirmTolerance: number
  exposureSeconds: number
}

/**
 * What the walk reads from a frame: the count and median HFR. The stars behind them are recorded,
 * and the fine pass reads their HFR spread to weight each sample. They never steer the walk.
 */
export type AutofocusMeasure = (
  ...args: Parameters<typeof measureAutofocusStars>
) => Promise<
  Pick<CaptureImageStatistics, 'detectedStars' | 'medianHfrPixels'> & { stars?: AutofocusStar[] }
>

export type AutofocusRecord = (run: AutofocusRun) => void

export function createAutofocusController(
  settings: {
    rigId: string
    rigName: string
    cameraName: string
    focuserName: string
  },
  now = Date.now,
  measure: AutofocusMeasure = measureAutofocusStars,
  record: AutofocusRecord = () => {},
  readAirTemperature: AutofocusAirTemperature = async () => null,
) {
  let view: AutofocusView = emptyView(settings, defaultRunSettings)
  let startedAt: string | undefined
  let settledAt: string | null = null
  /** The star table of `view.samples[i]`, kept apart so the polled view stays small. */
  let starTables: AutofocusStar[][] = []
  let travel: FocuserTravel | null = null
  let airTemperatureStartC: number | null = null
  let airTemperatureEndC: number | null = null
  let endReading: Promise<number | null> | undefined
  let running: Promise<void> | undefined
  let cancellation: AbortController | undefined
  let plannedReady: { resolve: () => void; reject: (error: Error) => void } | undefined

  function patch(next: Partial<AutofocusView>) {
    view = { ...view, ...next }
  }

  async function restore(focuser: AutofocusFocuser, limits: FocuserTravel | undefined, start: number) {
    patch({ activity: 'restoring' })

    try {
      if (limits) {
        const arrived = await approach(focuser, limits, start, 'restore-start', () =>
          AbortSignal.timeout(60_000),
        )

        patch({ currentPosition: arrived, restoredStart: arrived === start })
      } else {
        const status = await focuser.status(AbortSignal.timeout(15_000))
        patch({ currentPosition: status.position, restoredStart: status.position === start })
      }
    } catch {
      patch({ restoredStart: false, currentPosition: view.currentPosition })
      throw new Error(
        'The focuser did not confirm return to the start position. Vela did not repeat the move.',
      )
    }
  }

  async function sample(
    camera: AutofocusCamera,
    position: number,
    exposureSeconds: number,
    signal: AbortSignal,
    pass: AutofocusPass,
  ): Promise<AutofocusSample> {
    patch({
      activity: 'exposing',
      exposureStartedAt: new Date(now()).toISOString(),
      elapsedSeconds: 0,
      currentPosition: position,
      captureReadState: 'current',
    })
    let capturePending = true

    const frame = await camera
      .capture({
        exposureSeconds,
        signal,
        onProgress(elapsedSeconds) {
          if (capturePending && !signal.aborted) patch({ elapsedSeconds })
        },
        onReadState(captureReadState) {
          if (capturePending && !signal.aborted) patch({ captureReadState })
        },
      })
      .finally(() => {
        capturePending = false
        patch({ captureReadState: 'current' })
      })

    patch({ activity: 'measuring', elapsedSeconds: exposureSeconds })

    const stars: Awaited<ReturnType<AutofocusMeasure>> = await measure(
      frame.width,
      frame.height,
      frame.pixels,
      frame.color,
    ).catch(() => ({ detectedStars: 0, medianHfrPixels: null }))

    signal.throwIfAborted()

    const point: AutofocusSample = {
      position,
      detectedStars: stars.detectedStars,
      hfrPixels: stars.medianHfrPixels,
      capturedAt: frame.capturedAt,
      pass,
    }

    starTables.push(stars.stars ?? [])
    patch({ samples: [...view.samples, point] })

    return point
  }

  function beginEndReading() {
    if (endReading || !view.samples.length) return

    const abandoned = new AbortController()
    let timer: ReturnType<typeof setTimeout>

    const expired = new Promise<null>(resolve => {
      timer = setTimeout(() => {
        abandoned.abort()
        resolve(null)
      }, airTemperatureTimeoutMs)
    })

    endReading = Promise.race([readAirTemperature(abandoned.signal).catch(() => null), expired]).finally(
      () => clearTimeout(timer),
    )
  }

  /** The run so far, or the last one: its setup, fit and every sample with its star table. Null before a first sample. */
  function currentRun(): AutofocusRun | null {
    if (!startedAt || !view.samples.length) return null

    return {
      version: 1,
      rigId: view.rigId,
      startedAt,
      settledAt,
      phase: view.phase,
      error: view.error,
      startPosition: view.startPosition,
      stepSize: view.stepSize,
      offsetSteps: view.offsetSteps,
      fineStepSize: view.fineStepSize ?? DEFAULT_FINE_STEP_SIZE,
      fineOffsetSteps: view.fineOffsetSteps ?? DEFAULT_FINE_OFFSET_STEPS,
      confirmTolerance: view.confirmTolerance ?? DEFAULT_CONFIRM_TOLERANCE,
      travel,
      exposureSeconds: view.exposureSeconds,
      fit: view.fit,
      landing: view.landing ?? null,
      airTemperatureC: { start: airTemperatureStartC, end: airTemperatureEndC },
      samples: view.samples.map((sample, index) => ({ ...sample, stars: starTables[index] ?? [] })),
    }
  }

  async function moveTo(
    focuser: AutofocusFocuser,
    limits: FocuserTravel,
    position: number,
    signal: () => AbortSignal,
  ) {
    assertCommandedPosition(position, limits)

    const arrived = await focuser.move(
      position,
      { minPosition: limits.min, maxPosition: limits.max },
      signal(),
    )

    patch({ currentPosition: arrived.position })

    return arrived.position
  }

  /**
   * Goes up to the target plus the overshoot, inside travel, then down onto it, so the gear slack is
   * taken up the way every sample saw it.
   */
  async function comeDownOnto(
    focuser: AutofocusFocuser,
    limits: FocuserTravel,
    target: number,
    signal: () => AbortSignal,
  ) {
    const { via } = approachFromAbove(limits, target)

    if (via !== null) await moveTo(focuser, limits, via, signal)

    return moveTo(focuser, limits, target, signal)
  }

  /** A run-ending move: it comes down onto the target and records its route. */
  async function approach(
    focuser: AutofocusFocuser,
    limits: FocuserTravel,
    target: number,
    purpose: AutofocusApproach['purpose'],
    signal: () => AbortSignal,
  ) {
    patch({ finalApproach: { purpose, ...approachFromAbove(limits, target) } })

    return comeDownOnto(focuser, limits, target, signal)
  }

  /** A move to a sample. Going down it is one move; going up it comes down onto the target like the end of a run. */
  async function moveToSample(
    focuser: AutofocusFocuser,
    limits: FocuserTravel,
    target: number,
    signal: () => AbortSignal,
  ) {
    patch({ activity: 'moving' })

    if (view.currentPosition !== null && target < view.currentPosition)
      return moveTo(focuser, limits, target, signal)

    return comeDownOnto(focuser, limits, target, signal)
  }

  function abortStart(
    message: string,
    status?: { position: number; minStep?: number; maxStep: number },
  ) {
    patch({
      phase: 'setup',
      activity: 'idle',
      active: false,
      restoredStart: false,
      startPosition: null,
      samples: [],
      fit: null,
      landing: null,
      error: message,
      exposureStartedAt: null,
      currentPosition: status?.position ?? view.currentPosition,
      minStep: status?.minStep ?? view.minStep ?? null,
      maxStep: status?.maxStep ?? view.maxStep,
    })
    plannedReady?.resolve()
    plannedReady = undefined
  }

  async function run(
    camera: AutofocusCamera,
    focuser: AutofocusFocuser,
    options: RunSettings,
    signal: AbortSignal,
  ) {
    let limits: FocuserTravel
    let start: number
    let coarsePositions: number[]

    try {
      const status = await focuser.status(signal)

      if (!status.absolute) {
        abortStart('Autofocus needs an absolute focuser', status)

        return
      }

      if (status.moving) {
        abortStart('The focuser is already moving', status)

        return
      }

      const planned = planStarHfrWalk(
        status.position,
        options.stepSize,
        options.offsetSteps,
        status.maxStep,
        status.minStep,
      )

      if (!planned.ok) {
        abortStart(planned.message, status)

        return
      }

      limits = planned.plan.travel
      start = planned.plan.start
      coarsePositions = planned.plan.positions
      travel = limits
      patch({
        phase: 'walking',
        startPosition: start,
        currentPosition: start,
        minStep: status.minStep ?? null,
        maxStep: status.maxStep,
        stepSize: planned.plan.stepSize,
        offsetSteps: planned.plan.offsetSteps,
        restoredStart: false,
        finalApproach: null,
        samples: [],
        fit: null,
        landing: null,
        error: null,
      })
      plannedReady?.resolve()
      plannedReady = undefined
    } catch (error) {
      abortStart(error instanceof Error ? error.message : 'Autofocus did not start')

      return
    }

    /**
     * Samples one pass until its lowest HFR has a sample on each side, extending the window toward
     * the lower HFR when it does not. Returns the position of that lowest sample.
     */
    async function sweep(pass: 'coarse' | 'fine', centre: number, settings: PassSettings, planned?: number[]) {
      const positions = planned ?? planPass(centre, settings, limits)

      for (;;) {
        signal.throwIfAborted()
        const next = nextInPass(positions, settings.stepSize, limits, view.samples.filter(sample => sample.pass === pass))

        if (next.kind === 'closed') return next.lowest

        if (next.kind === 'no-stars')
          throw new Error(`The ${pass} pass measured no stars. Returning to the start position.`)

        if (next.kind === 'travel-limit') {
          throw new Error(
            `HFR was still falling at the ${next.edge} end of the focuser travel (${next.lowest}). Vela did not move past it. Returning to the start position.`,
          )
        }

        await moveToSample(focuser, limits, next.position, () => signal)
        await sample(camera, next.position, options.exposureSeconds, signal, pass)
      }
    }

    /**
     * Comes down onto the fitted position, or the best sample if there was no fit, and takes a confirm
     * frame. A frame worse than the best sample by more than the tolerance sends the focuser to that
     * sample, again from above, for a second frame.
     */
    async function land(choice: FocusChoice): Promise<AutofocusLanding> {
      const attempts: AutofocusLandingAttempt[] = []
      let source = choice.source
      let position = choice.position

      for (;;) {
        patch({ activity: 'moving' })
        await approach(focuser, limits, position, source === 'fit' ? 'best-focus' : 'best-sample', () => signal)
        const confirm = await sample(camera, position, options.exposureSeconds, signal, 'confirm')
        const withinTolerance = confirmsBest(confirm.hfrPixels, choice.best.hfrPixels, options.confirmTolerance)

        attempts.push({
          source,
          position,
          sampleIndex: view.samples.length - 1,
          hfrPixels: confirm.hfrPixels,
          withinTolerance,
        })

        if (withinTolerance || position === choice.best.position) break
        source = 'best-sample'
        position = choice.best.position
      }

      const last = attempts[attempts.length - 1]!

      return {
        position: last.position,
        outcome: !last.withinTolerance ? 'unconfirmed' : attempts.length > 1 ? 'fell-back' : 'confirmed',
        bestSample: choice.best,
        tolerance: options.confirmTolerance,
        attempts,
      }
    }

    try {
      const coarseMinimum = await sweep(
        'coarse',
        start,
        { stepSize: options.stepSize, offsetSteps: options.offsetSteps },
        coarsePositions,
      )

      await sweep('fine', coarseMinimum, { stepSize: options.fineStepSize, offsetSteps: options.fineOffsetSteps })

      patch({ phase: 'fitting', activity: 'fitting' })

      const choice = chooseFocus(
        view.samples.flatMap((sample, index) =>
          sample.pass === 'fine'
            ? [{ ...sample, starHfrs: (starTables[index] ?? []).map(star => star.hfr) }]
            : [],
        ),
      )

      if (!choice) throw new Error('The fine pass measured no stars. Returning to the start position.')
      patch({ fit: choice.fit })
      signal.throwIfAborted()
      patch({ phase: 'confirming', activity: 'moving' })
      const landing = await land(choice)
      beginEndReading()
      signal.throwIfAborted()
      patch({
        phase: 'complete',
        activity: 'idle',
        active: false,
        restoredStart: false,
        landing,
        error: null,
        exposureStartedAt: null,
      })
    } catch (error) {
      const cancelled = error instanceof AutofocusStoppedError
      beginEndReading()

      try {
        await focuser.halt()
      } catch {
        /* halt is best-effort before restore */
      }

      if (error instanceof AutofocusFocuserUncertainError) {
        patch({
          phase: 'failed',
          activity: 'idle',
          active: false,
          restoredStart: false,
          error: `${error.message}. Vela did not move the focuser again; check where it is.`,
          exposureStartedAt: null,
        })

        return
      }

      try {
        await restore(focuser, limits, start)
        patch({
          phase: cancelled ? 'stopped' : 'failed',
          activity: 'idle',
          active: false,
          error: cancelled ? null : error instanceof Error ? error.message : 'Autofocus failed',
          exposureStartedAt: null,
        })
      } catch (restoreError) {
        patch({
          phase: 'failed',
          activity: 'idle',
          active: false,
          restoredStart: false,
          error:
            restoreError instanceof Error
              ? restoreError.message
              : 'Start position was not restored',
          exposureStartedAt: null,
        })
      }
    }
  }

  async function start(
    camera: AutofocusCamera,
    focuser: AutofocusFocuser,
    {
      stepSize = DEFAULT_STEP_SIZE,
      offsetSteps = DEFAULT_OFFSET_STEPS,
      fineStepSize = DEFAULT_FINE_STEP_SIZE,
      fineOffsetSteps = DEFAULT_FINE_OFFSET_STEPS,
      confirmTolerance = DEFAULT_CONFIRM_TOLERANCE,
      exposureSeconds = 2,
      airTemperatureStartC: startTemperatureC = null,
      onSettled,
    }: AutofocusRunOptions = {},
  ) {
    if (running) throw new Error('Autofocus is already running')

    if (!Number.isSafeInteger(stepSize) || stepSize < 1 || stepSize > 2000)
      throw new Error('Step size must be an integer from 1 to 2000')

    if (!Number.isSafeInteger(offsetSteps) || offsetSteps < 1 || offsetSteps > 10)
      throw new Error('Offset steps must be an integer from 1 to 10')

    if (!Number.isSafeInteger(fineStepSize) || fineStepSize < 1 || fineStepSize > 2000)
      throw new Error('Fine step size must be an integer from 1 to 2000')

    if (!Number.isSafeInteger(fineOffsetSteps) || fineOffsetSteps < 1 || fineOffsetSteps > 10)
      throw new Error('Fine offset steps must be an integer from 1 to 10')

    if (!Number.isFinite(confirmTolerance) || confirmTolerance <= 0 || confirmTolerance > 1)
      throw new Error('Confirm tolerance must be above 0 and at most 1')

    if (!Number.isFinite(exposureSeconds) || exposureSeconds < 0.1 || exposureSeconds > 30)
      throw new Error('Exposure duration must be between 0.1 and 30 seconds')
    cancellation = new AbortController()
    startedAt = new Date(now()).toISOString()
    settledAt = null
    starTables = []
    travel = null
    airTemperatureStartC = startTemperatureC
    airTemperatureEndC = null
    endReading = undefined

    const runSettings: RunSettings = {
      stepSize,
      offsetSteps,
      fineStepSize,
      fineOffsetSteps,
      confirmTolerance,
      exposureSeconds,
    }

    patch({
      ...emptyView(settings, runSettings),
      cameraName: settings.cameraName,
      focuserName: settings.focuserName,
      phase: 'walking',
      activity: 'moving',
      active: true,
    })

    const whenPlanned = new Promise<void>((resolve, reject) => {
      plannedReady = { resolve, reject }
    })

    running = run(camera, focuser, runSettings, cancellation.signal).finally(async () => {
      airTemperatureEndC = (await endReading) ?? null
      running = undefined
      settledAt = new Date(now()).toISOString()
      patch({
        active: false,
        captureReadState: 'current',
        activity:
          view.phase === 'complete'
            ? 'idle'
            : view.activity === 'stopping'
              ? 'idle'
              : view.activity,
      })
      onSettled?.()

      const settled = currentRun()

      if (settled) record(settled)
    })

    try {
      await whenPlanned
    } catch (error) {
      await running.catch(() => undefined)
      throw error
    }

    return view
  }

  async function stop() {
    if (running) {
      patch({ activity: 'stopping', captureReadState: 'current' })
      cancellation!.abort(new AutofocusStoppedError())
      await running
    }

    return view
  }

  return { start, stop, snapshot: () => view, run: currentRun, active: () => !!running }
}

const defaultRunSettings: RunSettings = {
  stepSize: DEFAULT_STEP_SIZE,
  offsetSteps: DEFAULT_OFFSET_STEPS,
  fineStepSize: DEFAULT_FINE_STEP_SIZE,
  fineOffsetSteps: DEFAULT_FINE_OFFSET_STEPS,
  confirmTolerance: DEFAULT_CONFIRM_TOLERANCE,
  exposureSeconds: 2,
}

function emptyView(
  settings: {
    rigId: string
    rigName: string
    cameraName: string
    focuserName: string
  },
  run: RunSettings,
): AutofocusView {
  return {
    rigId: settings.rigId,
    rigName: settings.rigName,
    enabled: true,
    unavailableReason: null,
    cameraName: settings.cameraName,
    focuserName: settings.focuserName,
    phase: 'setup',
    activity: 'idle',
    active: false,
    captureReadState: 'current',
    startPosition: null,
    currentPosition: null,
    minStep: null,
    maxStep: null,
    stepSize: run.stepSize,
    offsetSteps: run.offsetSteps,
    fineStepSize: run.fineStepSize,
    fineOffsetSteps: run.fineOffsetSteps,
    confirmTolerance: run.confirmTolerance,
    exposureSeconds: run.exposureSeconds,
    elapsedSeconds: 0,
    exposureStartedAt: null,
    samples: [],
    fit: null,
    landing: null,
    restoredStart: false,
    finalApproach: null,
    error: null,
  }
}
