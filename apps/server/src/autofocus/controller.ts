import type { AutofocusFit, AutofocusSample, AutofocusView } from '@vela/model/web'
import type { CaptureFrame } from '../capture/controller.js'
import { measureAutofocusStars } from '../imaging/statistics.js'
import { fitHyperbola } from './hyperbola.js'
import {
  DEFAULT_OFFSET_STEPS,
  DEFAULT_STEP_SIZE,
  extraInwardPosition,
  planStarHfrWalk,
  assertCommandedPosition,
  type AutofocusWalkPlan,
} from './walk.js'

// Device boundaries may report cancellation only after confirming cleanup.
export class AutofocusStoppedError extends Error {
  constructor() {
    super('Autofocus stopped')
    this.name = 'AutofocusStoppedError'
  }
}

export interface AutofocusFocuser {
  status(signal?: AbortSignal): Promise<{ absolute: boolean, position: number, maxStep: number, moving: boolean }>
  move(position: number, window: { minPosition: number, maxPosition: number }, signal?: AbortSignal): Promise<{ position: number }>
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
  stepSize?: number
  offsetSteps?: number
  exposureSeconds?: number
  onSettled?: () => void
}

const rSquaredGate = 0.7

export function createAutofocusController(
  settings: { rigId: string, rigName: string, cameraName: string, focuserName: string },
  now = Date.now,
  measure = measureAutofocusStars,
) {
  let view: AutofocusView = emptyView(settings, DEFAULT_STEP_SIZE, DEFAULT_OFFSET_STEPS)
  let running: Promise<void> | undefined
  let cancellation: AbortController | undefined
  let plannedReady: { resolve: () => void, reject: (error: Error) => void } | undefined

  function patch(next: Partial<AutofocusView>) { view = { ...view, ...next } }

  async function restore(focuser: AutofocusFocuser, plan: AutofocusWalkPlan | undefined, start: number) {
    patch({ activity: 'restoring' })

    try {
      if (plan) {
        assertCommandedPosition(start, plan)
        const arrived = await focuser.move(start, { minPosition: plan.minPosition, maxPosition: plan.maxPosition }, AbortSignal.timeout(60_000))
        patch({ currentPosition: arrived.position, restoredStart: arrived.position === start })
      } else {
        const status = await focuser.status(AbortSignal.timeout(15_000))
        patch({ currentPosition: status.position, restoredStart: status.position === start })
      }
    } catch {
      patch({ restoredStart: false, currentPosition: view.currentPosition })
      throw new Error('The focuser did not confirm return to the start position. Vela did not repeat the move.')
    }
  }

  async function sample(camera: AutofocusCamera, position: number, exposureSeconds: number, signal: AbortSignal): Promise<AutofocusSample> {
    patch({ activity: 'exposing', exposureStartedAt: new Date(now()).toISOString(), elapsedSeconds: 0, currentPosition: position, captureReadState: 'current' })
    let capturePending = true

    const frame = await camera.capture({
      exposureSeconds,
      signal,
      onProgress(elapsedSeconds) { if (capturePending && !signal.aborted) patch({ elapsedSeconds }) },
      onReadState(captureReadState) { if (capturePending && !signal.aborted) patch({ captureReadState }) },
    }).finally(() => {
      capturePending = false
      patch({ captureReadState: 'current' })
    })

    patch({ activity: 'measuring', elapsedSeconds: exposureSeconds })
    const stars = await measure(frame.width, frame.height, frame.pixels, frame.color).catch(() => ({ detectedStars: 0, medianHfrPixels: null }))

    signal.throwIfAborted()

    const point: AutofocusSample = {
      position,
      detectedStars: stars.detectedStars,
      hfrPixels: stars.medianHfrPixels,
      capturedAt: frame.capturedAt,
    }

    patch({ samples: [...view.samples, point] })

    return point
  }

  async function go(focuser: AutofocusFocuser, plan: AutofocusWalkPlan, position: number, signal: AbortSignal) {
    assertCommandedPosition(position, plan, extraFloor(plan))
    patch({ activity: 'moving', currentPosition: view.currentPosition })

    const arrived = await focuser.move(position, {
      minPosition: Math.max(1, extraFloor(plan)),
      maxPosition: plan.maxPosition,
    }, signal)

    patch({ currentPosition: arrived.position })

    return arrived.position
  }

  function abortStart(message: string, status?: { position: number, maxStep: number }) {
    patch({
      phase: 'setup', activity: 'idle', active: false, restoredStart: false,
      startPosition: null, samples: [], fit: null, error: message, exposureStartedAt: null,
      currentPosition: status?.position ?? view.currentPosition,
      maxStep: status?.maxStep ?? view.maxStep,
    })
    plannedReady?.resolve()
    plannedReady = undefined
  }

  async function run(camera: AutofocusCamera, focuser: AutofocusFocuser, stepSize: number, offsetSteps: number, exposureSeconds: number, signal: AbortSignal) {
    let plan: AutofocusWalkPlan

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

      const planned = planStarHfrWalk(status.position, stepSize, offsetSteps, status.maxStep)

      if (!planned.ok) {
        abortStart(planned.message, status)

        return
      }

      plan = planned.plan
      patch({
        phase: 'walking', startPosition: plan.start, currentPosition: plan.start, maxStep: plan.maxStep,
        stepSize: plan.stepSize, offsetSteps: plan.offsetSteps, restoredStart: false, samples: [], fit: null, error: null,
      })
      plannedReady?.resolve()
      plannedReady = undefined
    } catch (error) {
      abortStart(error instanceof Error ? error.message : 'Autofocus did not start')

      return
    }

    try {
      const targets = [...plan.positions]

      for (const position of targets) {
        signal.throwIfAborted()
        await go(focuser, plan, position, signal)
        await sample(camera, position, exposureSeconds, signal)
      }

      while (true) {
        const extra = extraInwardPosition(plan, view.samples)

        if (extra === undefined) break
        signal.throwIfAborted()
        await go(focuser, plan, extra, signal)
        await sample(camera, extra, exposureSeconds, signal)
      }

      patch({ phase: 'fitting', activity: 'fitting' })
      const fit = bestFocus(view.samples)

      if (!fit) throw new Error('The hyperbola did not find a focus inside the sampled window. Returning to the start position.')
      patch({ fit })
      signal.throwIfAborted()
      patch({ phase: 'confirming' })
      await go(focuser, plan, fit.position, signal)
      await sample(camera, fit.position, exposureSeconds, signal)
      signal.throwIfAborted()
      patch({ phase: 'complete', activity: 'idle', active: false, restoredStart: false, error: null, exposureStartedAt: null })
    } catch (error) {
      const cancelled = error instanceof AutofocusStoppedError

      try { await focuser.halt() }
      catch { /* halt is best-effort before restore */ }

      try {
        await restore(focuser, plan, plan.start)
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
          error: restoreError instanceof Error ? restoreError.message : 'Start position was not restored',
          exposureStartedAt: null,
        })
      }
    }
  }

  async function start(camera: AutofocusCamera, focuser: AutofocusFocuser, {
    stepSize = DEFAULT_STEP_SIZE, offsetSteps = DEFAULT_OFFSET_STEPS, exposureSeconds = 2, onSettled,
  }: AutofocusRunOptions = {}) {
    if (running) throw new Error('Autofocus is already running')

    if (!Number.isSafeInteger(stepSize) || stepSize < 1 || stepSize > 2000) throw new Error('Step size must be an integer from 1 to 2000')

    if (!Number.isSafeInteger(offsetSteps) || offsetSteps < 1 || offsetSteps > 10) throw new Error('Offset steps must be an integer from 1 to 10')

    if (!Number.isFinite(exposureSeconds) || exposureSeconds < 0.1 || exposureSeconds > 30) throw new Error('Exposure duration must be between 0.1 and 30 seconds')
    cancellation = new AbortController()
    patch({
      ...emptyView(settings, stepSize, offsetSteps),
      cameraName: settings.cameraName,
      focuserName: settings.focuserName,
      phase: 'walking',
      activity: 'moving',
      active: true,
      exposureSeconds,
    })
    const whenPlanned = new Promise<void>((resolve, reject) => { plannedReady = { resolve, reject } })
    running = run(camera, focuser, stepSize, offsetSteps, exposureSeconds, cancellation.signal).finally(() => {
      running = undefined
      patch({ active: false, captureReadState: 'current', activity: view.phase === 'complete' ? 'idle' : view.activity === 'stopping' ? 'idle' : view.activity })
      onSettled?.()
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

  return { start, stop, snapshot: () => view, active: () => !!running }
}

function emptyView(settings: { rigId: string, rigName: string, cameraName: string, focuserName: string }, stepSize: number, offsetSteps: number): AutofocusView {
  return {
    rigId: settings.rigId, rigName: settings.rigName, enabled: true, unavailableReason: null,
    cameraName: settings.cameraName, focuserName: settings.focuserName,
    phase: 'setup', activity: 'idle', active: false,
    captureReadState: 'current',
    startPosition: null, currentPosition: null, maxStep: null,
    stepSize, offsetSteps, exposureSeconds: 2, elapsedSeconds: 0, exposureStartedAt: null,
    samples: [], fit: null, restoredStart: false, error: null,
  }
}

function extraFloor(plan: AutofocusWalkPlan) {
  return plan.start - (plan.offsetSteps + 2) * plan.stepSize
}

function bestFocus(samples: AutofocusSample[]): AutofocusFit | null {
  const points = samples.flatMap(sample => sample.hfrPixels === null ? [] : [{ x: sample.position, y: sample.hfrPixels }])
  const curve = fitHyperbola(points)

  if (!curve || curve.rSquared < rSquaredGate) return null
  const sampled = samples.map(sample => sample.position)
  const position = Math.round(curve.p)

  if (position < Math.min(...sampled) || position > Math.max(...sampled)) return null
  const measured = samples.filter(sample => sample.hfrPixels !== null)

  if (!measured.length) return null
  const lowest = measured.reduce((best, sample) => sample.hfrPixels! < best.hfrPixels! ? sample : best)

  return { position, p: curve.p, a: curve.a, b: curve.b, rSquared: curve.rSquared, minSamplePosition: lowest.position }
}
