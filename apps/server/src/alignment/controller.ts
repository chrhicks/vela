import { randomUUID } from 'node:crypto'
import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import { setTimeout as delay } from 'node:timers/promises'
import type { AlignmentExposureImage, AlignmentView } from '@vela/model/web'
import {
  AlpacaProviderError,
  AlpacaCaptureRetryableError,
  type AlpacaAcquisition,
  type AlpacaFrame,
} from '@vela/alpaca'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample } from './geometry.js'
import { createAstapSolver, projectSky, type SkyPosition } from './solver.js'
import { detailRegion, prepareAlignmentDisplay, type AlignmentDisplay } from './display.js'
import { fitFactor } from '../imaging/preview.js'
import type { PhysicalAlignment } from './physical.js'
import type {
  AlignmentDiagnosticRun,
  AlignmentDiagnosticsFactory,
  AlignmentFrameEvidence,
} from './diagnostics.js'

/** Explicit server configuration keeps the synthetic clock separate from physical rigs. */
export interface AlignmentSettings {
  mode?: 'offline' | 'physical'
  endpoint: string
  cameraId: string
  telescopeId: string
  executable: string
  catalogPath: string
  exposureSeconds: number
  fieldHeightDegrees: number
  diagnosticsPath?: string
}

type Solver = ReturnType<typeof createAstapSolver>

export type AlignmentControllerOptions = {
  settings: Pick<
    AlignmentSettings,
    'cameraId' | 'telescopeId' | 'exposureSeconds' | 'fieldHeightDegrees'
  >
  hardware: AlpacaAcquisition
  now?: () => number
  waitForNextExposure?: (signal: AbortSignal) => Promise<void>
  prepareDisplay?: typeof prepareAlignmentDisplay
  openDiagnostics?: AlignmentDiagnosticsFactory | undefined
} & (
  | { mode: 'offline'; solver: Solver }
  | {
      mode: 'physical'
      physical: PhysicalAlignment
      createSolver: (fieldHeightDegrees: number) => Solver
    }
)

export function createAlignmentController(options: AlignmentControllerOptions) {
  const {
    settings,
    hardware,
    now = Date.now,
    waitForNextExposure = (signal: AbortSignal) => delay(3000, undefined, { signal }),
    prepareDisplay = prepareAlignmentDisplay,
  } = options

  const physical = options.mode === 'physical' ? options.physical : undefined
  let fieldHeightDegrees = settings.fieldHeightDegrees

  let view: AlignmentView = {
    rigId: '',
    rigName: '',
    enabled: true,
    unavailableReason: null,
    phase: 'setup',
    activity: 'idle',
    active: false,
    position: 0,
    solvedPositions: 0,
    exposureSeconds: settings.exposureSeconds,
    exposureStartedAt: null,
    measuredAt: null,
    warning: null,
    error: null,
    measurement: null,
    preview: null,
  }

  if (physical) {
    view.mode = 'physical'
    view.cameraName = physical.cameraName
  }

  const tracer = trace.getTracer('vela.alignment')
  let runId = ''

  async function step<T>(
    name: string,
    work: () => Promise<T>,
    attributes: Attributes = {},
  ): Promise<T> {
    return tracer.startActiveSpan(
      name,
      {
        attributes: { 'alignment.run.id': runId, 'rig.id': view.rigId, ...attributes },
      },
      async span => {
        try {
          return await work()
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError')
            span.setAttribute('operation.cancelled', true)
          else {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : 'Alignment failed',
            })

            if (error instanceof Error) span.recordException(error)
          }

          throw error
        } finally {
          span.end()
        }
      },
    )
  }

  let running: Promise<void> | undefined
  let controller: AbortController | undefined
  let previousSample: AlignmentSample | undefined
  let diagnostics: AlignmentDiagnosticRun | undefined
  let finishRequested = false
  /** Display images of recent exposures, prepared beside the correction path. */
  const images = new Map<string, RetainedImage>()
  const preparing = new Set<Promise<unknown>>()
  let frameSequence = 0
  let previewSequence = 0

  function patch(next: Partial<AlignmentView>) {
    view = { ...view, ...next }
  }

  async function retryObservation<T>(
    read: () => Promise<T>,
    signal: AbortSignal,
    retryable = (error: Error) =>
      error instanceof AlpacaProviderError && error.reason === 'transport',
  ): Promise<T> {
    const activity = view.activity
    let interrupted = false

    while (true) {
      signal.throwIfAborted()

      try {
        const result = await read()
        signal.throwIfAborted()

        if (interrupted) patch({ activity, warning: null })

        return result
      } catch (error) {
        if (!(error instanceof Error) || !retryable(error)) throw error
        signal.throwIfAborted()
        interrupted = true
        patch({
          activity: 'retrying',
          exposureStartedAt: null,
          warning: 'Device connection interrupted. Retrying automatically.',
        })
        tracer
          .startSpan('alignment.read.interrupted', {
            attributes: {
              'alignment.run.id': runId,
              'rig.id': view.rigId,
              'error.message': error instanceof Error ? error.message : 'Device read interrupted',
            },
          })
          .end()
        await waitForNextExposure(signal)
      }
    }
  }

  async function start(rigId: string, rigName: string, onSettled?: () => void) {
    if (running) throw new Error('A measurement is already running')
    controller = new AbortController()
    previousSample = undefined
    diagnostics = undefined
    finishRequested = false
    patch({
      rigId,
      rigName,
      active: true,
      phase: 'baseline',
      activity: 'idle',
      position: 1,
      solvedPositions: 0,
      measurement: null,
      preview: null,
      measuredAt: null,
      exposureStartedAt: null,
      error: null,
      warning: null,
    })
    images.clear()
    runId = randomUUID()
    const signal = controller.signal
    running = step('alignment.run', async () => {
      // An ended marker makes a new run visible before its long root span ends.
      tracer
        .startSpan('alignment.started', {
          attributes: { 'alignment.run.id': runId, 'rig.id': rigId },
        })
        .end()
      diagnostics = await options.openDiagnostics?.({
        runId,
        rigId,
        rigName,
        mode: options.mode,
        cameraId: settings.cameraId,
        telescopeId: settings.telescopeId,
        cameraName: physical?.cameraName ?? 'Configured offline camera',
        exposureSeconds: settings.exposureSeconds,
      })
      signal.throwIfAborted()
      await run(signal)
    })
      .catch(error => {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          patch({
            phase: 'failed',
            warning: null,
            error: error instanceof Error ? error.message : 'Alignment failed',
          })
        }
      })
      .finally(async () => {
        // Display preparation stops with the run; wait so none outlives it.
        await Promise.allSettled(preparing)
        await diagnostics?.finish({
          phase:
            view.phase === 'failed'
              ? 'failed'
              : finishRequested && view.measurement
                ? 'finished'
                : 'stopped',
          error: view.error,
        })
        patch({ active: false, activity: 'idle', exposureStartedAt: null })
        running = undefined
        onSettled?.()
      })

    return view
  }

  async function stop(finished = false) {
    if (running) {
      finishRequested ||= finished
      patch({ activity: 'stopping', exposureStartedAt: null, warning: null })
      await step('alignment.stop.requested', async () => {
        controller?.abort()
      })
      await running
    }

    if (view.phase !== 'failed')
      patch({ phase: finished && view.measurement ? 'finished' : 'stopped' })

    return view
  }

  /** `afterSettling`: the adjustment window just ended, so that wait is also the settling allowance. */
  async function acquireFrame(signal: AbortSignal, afterSettling: boolean) {
    let exposureRequestedAt: number | undefined

    const acquired = await retryObservation(
      async () => {
        // A safe pre-start retry still needs a fresh mount observation and solve hint.
        const actual = physical
          ? await retryObservation(() => physical.pointing(signal, { afterSettling }), signal)
          : undefined

        const pointing = actual
          ? undefined
          : await retryObservation(() => hardware.pointing(settings.telescopeId, signal), signal)

        const pointingObservedAt = now()

        if (pointing && pointing.coordinateSystem !== 'j2000')
          throw new Error(
            'This configured alignment model requires the simulator’s J2000 coordinate frame',
          )

        if (pointing && !pointing.tracking)
          throw new Error('Tracking must be enabled before measuring alignment')
        const exposureStartedAt = new Date(now()).toISOString()
        patch({ activity: 'exposing', exposureStartedAt, warning: null })
        let capturePending = true

        const frame = await step(
          'alignment.capture',
          () =>
            hardware.capture({
              cameraId: settings.cameraId,
              exposureSeconds: settings.exposureSeconds,
              signal,
              ...(physical
                ? { expectedCameraName: physical.cameraName }
                : { monochromeOnly: true }),
              onExposureRequested() {
                exposureRequestedAt = performance.now()
              },
              onReadState(state) {
                if (!capturePending || signal.aborted) return
                patch(
                  state === 'retrying'
                    ? {
                        activity: 'retrying',
                        exposureStartedAt: null,
                        warning: 'Device connection interrupted. Retrying automatically.',
                      }
                    : { activity: 'exposing', exposureStartedAt, warning: null },
                )
              },
            }),
          { 'alignment.position': view.position },
        ).finally(() => {
          capturePending = false
        })

        return { frame, actual, pointing, pointingObservedAt }
      },
      signal,
      error => error instanceof AlpacaCaptureRetryableError,
    )

    return { ...acquired, timing: frameTiming(exposureRequestedAt) }
  }

  /** Monotonic milestones of one exposure, persisted as compact trace records. */
  function frameTiming(exposureRequestedAt = performance.now()) {
    const pixelsMs = performance.now() - exposureRequestedAt
    let solvedMs: number | undefined

    const record = (name: string, attributes: Attributes) =>
      tracer
        .startSpan(name, {
          attributes: {
            'alignment.run.id': runId,
            'rig.id': view.rigId,
            'alignment.timing.pixels_ms': pixelsMs,
            ...attributes,
          },
        })
        .end()

    return {
      solved() {
        solvedMs = performance.now() - exposureRequestedAt
      },
      published(outcome: 'baseline' | 'measurement' | 'no-solution', attributes: Attributes) {
        record('alignment.frame', {
          'alignment.frame.outcome': outcome,
          'alignment.timing.solved_ms': solvedMs,
          'alignment.timing.published_ms': performance.now() - exposureRequestedAt,
          ...attributes,
        })
      },
      displayed(attributes: Attributes) {
        record('alignment.frame.display', {
          'alignment.timing.display_ms': performance.now() - exposureRequestedAt,
          ...attributes,
        })
      },
    }
  }

  /**
   * Prepare this exposure's display images without delaying its correction. The
   * work belongs to the frame: it stops with the run or a failed frame, and Stop
   * waits for it. Image requests wait for it; nothing else depends on it.
   */
  function prepareFrameDisplay(
    frameId: string,
    frame: AlpacaFrame,
    signal: AbortSignal,
    timing: ReturnType<typeof frameTiming>,
  ) {
    const display = step('alignment.preview', () => prepareDisplay(frame, signal)).then(
      prepared => {
        timing.displayed({ 'alignment.frame.id': frameId, 'alignment.image.fit_bytes': prepared.fit.length })

        return prepared
      },
    )

    const settled = display.then(
      () => undefined,
      () => undefined,
    )

    preparing.add(settled)
    void settled.then(() => preparing.delete(settled))
    images.set(frameId, { display })

    // Keep the last solved image available even through many unsuccessful frames.
    const measuredFrameId = view.measurement?.frameId

    for (const id of images.keys()) {
      if (images.size <= 4) break

      if (id !== measuredFrameId) images.delete(id)
    }

    return display
  }

  /** Publish a validated exposure's preview once its display is ready, unless a newer one is shown. */
  function showPreviewWhenReady(
    frameId: string,
    sequence: number,
    frame: AlpacaFrame,
    display: Promise<AlignmentDisplay>,
    signal: AbortSignal,
  ) {
    void display.then(
      () => {
        if (signal.aborted || sequence <= previewSequence || !images.has(frameId)) return
        previewSequence = sequence

        const preview: NonNullable<AlignmentView['preview']> = {
          ...exposureImage(frameId, frame),
          capturedAt: frame.capturedAt,
          position: view.position,
        }

        if (frame.capturedAtSource) preview.capturedAtSource = frame.capturedAtSource
        patch({ preview })
      },
      () => undefined,
    )
  }

  function exposureImage(
    frameId: string,
    frame: { width: number; height: number },
  ): AlignmentExposureImage {
    const imageUrl = `/api/rigs/${encodeURIComponent(view.rigId)}/alignment/images/${frameId}`

    return {
      frameId,
      imageUrl,
      imageWidth: frame.width,
      imageHeight: frame.height,
      fitImageUrl: `${imageUrl}/fit`,
      fitImageScale: fitFactor(frame.width, frame.height),
    }
  }

  async function acquire(solver: Solver, signal: AbortSignal, afterSettling: boolean) {
    const { frame, actual, pointing, pointingObservedAt, timing } = await acquireFrame(
      signal,
      afterSettling,
    )

    signal.throwIfAborted()
    patch({ activity: 'solving', exposureStartedAt: null })
    const frameId = randomUUID()
    const sequence = ++frameSequence
    const frameWork = followAbort(signal)
    const display = prepareFrameDisplay(frameId, frame, frameWork.signal, timing)
    void display.then(frameWork.release, frameWork.release)

    try {
      const hint: SkyPosition = actual?.hint ?? {
        raDegrees: pointing!.rightAscensionDegrees,
        decDegrees: pointing!.declinationDegrees,
      }

      // The correction path: capture validation beside the solve, then one final check.
      // Display preparation runs separately and never delays a correction.
      const [afterCapture, solved] = await together(signal, workSignal => [
        (physical
          ? retryObservation(() => physical.validate(workSignal, frame), workSignal)
          : Promise.resolve(undefined)
        ).then(validated => {
          // A validated capture's preview may appear before its solve completes.
          showPreviewWhenReady(frameId, sequence, frame, display, frameWork.signal)

          return validated
        }),
        step(
          'alignment.solve',
          async () => {
            const result = await solver.solve(frame, hint, workSignal)

            trace.getActiveSpan()?.setAttribute('alignment.solve.outcome', result.status)
            timing.solved()

            return result
          },
          { 'alignment.position': view.position },
        ),
      ])

      signal.throwIfAborted()

      const frameRecord = {
        'alignment.position': view.position,
        'alignment.frame.id': frameId,
        'alignment.capture.timestamp_source': frame.capturedAtSource ?? 'camera',
      }

      if (solved.status === 'no-solution') {
        patch({ warning: 'Plate-solving failed. Trying a new image.' })
        timing.published('no-solution', frameRecord)

        return undefined
      }

      const solvedAt = new Date(now()).toISOString()

      const sample: AlignmentSample = physical
        ? physical.sample(solved, {
            capturedAt: frame.capturedAt,
            exposureSeconds: settings.exposureSeconds,
          })
        : {
            raDegrees: solved.raDegrees,
            decDegrees: solved.decDegrees,
            capturedAt: frame.capturedAt,
            siderealTimeDegrees:
              (pointing!.siderealTimeDegrees +
                (((Date.parse(frame.capturedAt) - pointingObservedAt) / 1000) * 360) /
                  86164.0905 +
                360) %
              360,
          }

      const evidence: AlignmentFrameEvidence = {
        phase: view.phase === 'baseline' ? 'baseline' : 'adjusting',
        position: view.position,
        solution: solved,
        sample,
        hint,
        fieldHeightDegrees,
      }

      if (actual && afterCapture) {
        evidence.physical = {
          site: actual.observation.site,
          camera: actual.observation.camera,
          before: actual.observation.mount,
          after: afterCapture,
        }
      }

      if (pointing) evidence.offlinePointing = pointing
      await diagnostics?.recordFrame(frame, evidence)
      signal.throwIfAborted()

      // One observation after all processing gates any correction from this exposure.
      const mount = physical
        ? await retryObservation(() => physical.validate(signal), signal)
        : undefined

      patch({ warning: null })

      if (view.phase === 'baseline') timing.published('baseline', frameRecord)

      if (previousSample) {
        const elapsed =
          (Date.parse(sample.capturedAt) - Date.parse(previousSample.capturedAt)) / 1000

        const expected = (elapsed * 360) / 86164.0905

        const observed =
          ((sample.siderealTimeDegrees - previousSample.siderealTimeDegrees + 540) % 360) - 180

        if (elapsed <= 0 || Math.abs(observed - expected) > 0.01)
          throw new Error('The rig clock or simulator baseline changed. Stop and measure again.')
      }

      previousSample = sample

      return {
        frame,
        frameId,
        display,
        solved,
        solvedAt,
        sample,
        mount,
        timing,
        frameRecord,
        latitude: actual?.latitude ?? pointing!.latitudeDegrees,
      }
    } catch (error) {
      // A failed exposure takes its display work with it.
      frameWork.abort()

      throw error
    }
  }

  async function solvedFrame(solver: Solver, signal: AbortSignal, afterSettling: boolean) {
    while (true) {
      const result = await acquire(solver, signal, afterSettling)

      if (result) return result
      patch({ activity: 'waiting' })
      await waitForNextExposure(signal)
      afterSettling = true
    }
  }

  async function run(signal: AbortSignal) {
    let solver: Solver

    if (options.mode === 'physical') {
      patch({ activity: 'homing' })
      fieldHeightDegrees = (await step('alignment.prepare', () => options.physical.prepare(signal)))
        .fieldHeightDegrees
      solver = options.createSolver(fieldHeightDegrees)
      patch({ activity: 'waiting' })
    } else {
      solver = options.solver
      const initial = await hardware.pointing(settings.telescopeId, signal)

      if (initial.coordinateSystem !== 'j2000' || !initial.tracking)
        throw new Error('The configured simulator’s J2000 frame and tracking are required')

      if (
        initial.rightAscensionDegrees < 8 ||
        initial.rightAscensionDegrees > 52 ||
        Math.abs(initial.declinationDegrees - 60) > 0.01
      ) {
        throw new Error('Reset the simulator to its northern alignment position before measuring')
      }

      // A wide baseline limits amplification of subpixel plate-solve uncertainty.
      // This sweep belongs to the explicitly configured offline model.
      const preparationDegrees = 12 - initial.rightAscensionDegrees

      if (Math.abs(preparationDegrees) > 0.1) {
        patch({ activity: 'moving' })
        await hardware.move(
          settings.telescopeId,
          Math.sign(preparationDegrees) * 1.5,
          Math.abs(preparationDegrees) / 1.5,
          signal,
        )
      }
    }

    const first = await solvedFrame(solver, signal, false)
    const samples: AlignmentSample[] = [first.sample]
    let current = first

    for (let position = 2; position <= 3; position++) {
      patch({ activity: 'moving', position, solvedPositions: position - 1 })

      if (physical)
        await step('alignment.move', () => physical.move(signal), {
          'alignment.position': position,
        })
      else await hardware.move(settings.telescopeId, 1.5, 12, signal)
      current = await solvedFrame(solver, signal, false)
      samples.push(current.sample)
    }

    // SAFETY: the initial sample and the two completed loop iterations supply exactly three solved positions.
    const baselineSamples = samples as [AlignmentSample, AlignmentSample, AlignmentSample]
    const baseline = createAlignmentBaseline(baselineSamples, first.latitude)
    await diagnostics?.recordBaseline(baselineSamples, first.latitude, baseline.measurement)
    signal.throwIfAborted()
    patch({ phase: 'adjusting', solvedPositions: 3 })

    while (true) {
      const measured = measureAlignment(baseline, current.sample, true)
      signal.throwIfAborted()

      // The frame's final observation already gated this correction; no new read is needed.
      await diagnostics?.recordMeasurement(current.sample, measured, current.mount)
      signal.throwIfAborted()

      const target = physical
        ? physical.project(current.solved.wcs, measured.correctionTarget, current.sample)
        : projectSky(current.solved.wcs, measured.correctionTarget)

      if (!target) throw new Error('Alignment target is outside the solvable camera projection')

      const { frame, frameId, display } = current

      const region = detailRegion(frame, {
        reference: { x: (frame.width - 1) / 2, y: (frame.height - 1) / 2 },
        target,
        arcsecPerPixel: (fieldHeightDegrees * 3600) / frame.height,
      })

      const measurement: NonNullable<AlignmentView['measurement']> = {
        altitudeArcsec: measured.altitudeArcsec,
        azimuthArcsec: measured.azimuthArcsec,
        totalArcsec: measured.totalArcsec,
        ...exposureImage(frameId, frame),
        solvedAt: current.solvedAt,
        targetX: target.x,
        targetY: target.y,
        fieldHeightDegrees,
      }

      const retained = images.get(frameId)

      if (region && retained) {
        retained.detail = display.then(prepared => prepared.detail(region))
        void retained.detail.catch(() => undefined)
        measurement.detail = { imageUrl: `${measurement.imageUrl}/detail`, ...region }
      }

      if (frame.capturedAtSource) measurement.capturedAtSource = frame.capturedAtSource
      patch({ measuredAt: frame.capturedAt, activity: 'waiting', measurement })
      current.timing.published('measurement', current.frameRecord)

      // A calm adjustment window between exposures; never infer solver progress from
      // elapsed time. It is also the settling allowance before the next exposure.
      await waitForNextExposure(signal)
      current = await solvedFrame(solver, signal, true)
    }
  }

  return {
    start,
    stop,
    snapshot: () => view,
    /** Waits for an exposure's display preparation; undefined if it is gone or failed. */
    image: async (id: string, kind: 'native' | 'fit' | 'detail') => {
      const retained = images.get(id)

      try {
        if (!retained) return undefined

        if (kind === 'detail') return await retained.detail

        const display = await retained.display

        return kind === 'fit' ? display.fit : await display.native()
      } catch {
        return undefined
      }
    },
    active: () => !!running,
  }
}

/**
 * Start independent work on one exposure. The first failure cancels the rest, and
 * nothing started here is still running when this settles.
 */
async function together<A, B>(
  signal: AbortSignal,
  start: (signal: AbortSignal) => [Promise<A>, Promise<B>],
): Promise<[A, B]> {
  const frame = new AbortController()
  const cancel = () => frame.abort(new DOMException('Exposure work cancelled', 'AbortError'))
  const failures: Error[] = []

  signal.addEventListener('abort', cancel, { once: true })

  try {
    if (signal.aborted) cancel()
    const work = start(frame.signal)

    for (const task of work) {
      task.catch(error => {
        failures.push(error)
        cancel()
      })
    }

    await Promise.allSettled(work)

    if (signal.aborted) throw signal.reason

    if (failures.length > 0) throw failures[0]

    return await Promise.all(work)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

interface RetainedImage {
  display: Promise<AlignmentDisplay>
  detail?: Promise<Buffer>
}

/** A child cancellation for one exposure's work; release detaches it from the run. */
function followAbort(signal: AbortSignal) {
  const child = new AbortController()
  const abort = () => child.abort(new DOMException('Exposure work cancelled', 'AbortError'))

  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })

  return {
    signal: child.signal,
    abort,
    release: () => signal.removeEventListener('abort', abort),
  }
}
