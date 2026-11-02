import { randomUUID } from 'node:crypto'
import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import { setTimeout as delay } from 'node:timers/promises'
import type { AlignmentExposureImage, AlignmentView } from '@vela/model/web'
import {
  EquipmentError,
  CaptureRetryableError,
  type Acquisition,
  type Frame,
} from '@vela/equipment'
import { fitPolarAxis, minimumFixes } from '@vela/rig-sky'
import { baselineFromAxis, measureAlignment, type AlignmentSample } from './geometry.js'
import { SWEEP_POSITIONS } from './sweep.js'
import { sweepFix } from './sweep-fit.js'
import type { DroppedReason } from './diagnostic-schema.js'
import { describeRejection, type PlateSolver, type SkyPosition } from '../plate-solving/judged-solver.js'
import { projectSky } from '../targets/sky.js'
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
  rigId?: string
  endpoint: string
  cameraId: string
  telescopeId: string
  executable: string
  catalogPath: string
  exposureSeconds: number
  fieldHeightDegrees: number
  diagnosticsPath?: string
  sweepRateDegreesPerSecond?: number
  maxLegSeconds?: number
}

type Solver = PlateSolver

export type AlignmentControllerOptions = {
  settings: Pick<
    AlignmentSettings,
    'cameraId' | 'telescopeId' | 'exposureSeconds' | 'fieldHeightDegrees'
  >
  hardware: Acquisition
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
  /** Each run takes the exposure chosen at Start; every exposure of the run uses it. */
  let exposureSeconds = settings.exposureSeconds

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
    exposureSeconds,
    exposureStartedAt: null,
    measuredAt: null,
    warning: null,
    error: null,
    rigidity: null,
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

  type SolvedFrame = Exclude<Awaited<ReturnType<typeof acquire>>, { dropped: Dropped }>

  function patch(next: Partial<AlignmentView>) {
    view = { ...view, ...next }
  }

  /** A transient read failure keeps the run and its context, and the read is retried at a paced, cancellable interval. */
  async function retryRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
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
        if (!(error instanceof EquipmentError && error.reason === 'transport')) throw error
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
              'error.message': error.message,
            },
          })
          .end()
        await waitForNextExposure(signal)
      }
    }
  }

  async function start(
    rigId: string,
    rigName: string,
    onSettled?: () => void,
    chosenExposureSeconds = settings.exposureSeconds,
  ) {
    if (running) throw new Error('A measurement is already running')
    exposureSeconds = chosenExposureSeconds
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
      exposureSeconds,
      measurement: null,
      preview: null,
      measuredAt: null,
      exposureStartedAt: null,
      error: null,
      rigidity: null,
      dropped: [],
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

    if (view.phase !== 'failed' && view.phase !== 'not-rigid')
      patch({ phase: finished && view.measurement ? 'finished' : 'stopped' })

    return view
  }

  /** `afterSettling`: the adjustment window just ended, so that wait is also the settling allowance. */
  async function acquireFrame(signal: AbortSignal, afterSettling: boolean) {
    let exposureRequestedAt: number | undefined

    const actual = physical
      ? await retryRead(() => physical.pointing(signal, { afterSettling }), signal)
      : undefined

    const pointing = actual
      ? undefined
      : await retryRead(() => hardware.pointing(settings.telescopeId, signal), signal)

    const pointingObservedAt = now()

    if (pointing && pointing.coordinateSystem !== 'j2000')
      throw new Error('This configured alignment model requires the simulator’s J2000 coordinate frame')

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
          exposureSeconds,
          signal,
          ...(physical ? { expectedCameraName: physical.cameraName } : { monochromeOnly: true }),
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

    return { frame, actual, pointing, pointingObservedAt, timing: frameTiming(exposureRequestedAt) }
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
    frame: Frame,
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
    position: number,
    frame: Frame,
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
          position,
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

  /**
   * One exposure, solved and checked. An exposure that gives no usable solve, or that the camera safely failed to take,
   * comes back as `dropped` and is never exposed again to repair it; anything else that goes wrong ends the run.
   */
  async function acquire(solver: Solver, signal: AbortSignal, afterSettling: boolean) {
    let taken: Awaited<ReturnType<typeof acquireFrame>>

    try {
      taken = await acquireFrame(signal, afterSettling)
    } catch (error) {
      if (!(error instanceof CaptureRetryableError)) throw error
      signal.throwIfAborted()

      await diagnostics?.recordDropped(view.position, 'capture-failed', error.message)

      return { dropped: { reason: 'capture-failed', detail: error.message } satisfies Dropped }
    }

    const { frame, actual, pointing, pointingObservedAt, timing } = taken
    signal.throwIfAborted()
    patch({ activity: 'solving', exposureStartedAt: null })
    const frameId = randomUUID()
    const sequence = ++frameSequence
    // The run may move on to the next position before this display is ready.
    const position = view.position
    const frameWork = followAbort(signal)
    let display: Promise<AlignmentDisplay> | undefined

    // Display preparation starts once the solve returns. Started earlier, its stretch
    // shares the event loop with the solver's FITS preparation and delays the correction.
    const prepare = () => {
      display ??= prepareFrameDisplay(frameId, frame, frameWork.signal, timing)
      void display.then(frameWork.release, frameWork.release)

      return display
    }

    try {
      const hint: SkyPosition = actual?.hint ?? {
        raDegrees: pointing!.rightAscensionDegrees,
        decDegrees: pointing!.declinationDegrees,
      }

      // The correction path: capture validation beside the solve, then one final check.
      const [afterCapture, solved] = await together(signal, workSignal => [
        physical
          ? retryRead(() => physical.validate(workSignal, frame), workSignal)
          : Promise.resolve(undefined),
        step(
          'alignment.solve',
          async () => {
            const result = await solver.solve(frame, hint, hint, workSignal)

            trace.getActiveSpan()?.setAttribute('alignment.solve.outcome', result.status)

            if (result.status === 'no-solution')
              trace.getActiveSpan()?.setAttribute('alignment.solve.reasons', result.reasons.join(','))
            timing.solved()
            prepare()

            return result
          },
          { 'alignment.position': view.position },
        ),
      ])

      // The validated capture's preview follows its display, including unsolved frames.
      showPreviewWhenReady(frameId, sequence, position, frame, prepare(), frameWork.signal)
      signal.throwIfAborted()

      const frameRecord = {
        'alignment.position': view.position,
        'alignment.frame.id': frameId,
        'alignment.capture.timestamp_source': frame.capturedAtSource ?? 'camera',
      }

      if (solved.status === 'no-solution') {
        await diagnostics?.recordRejected(frame, view.position, solved, hint)
        timing.published('no-solution', frameRecord)

        return {
          dropped: {
            reason: solved.reasons.includes('no-match') ? 'no-solve' : 'rejected',
            detail: describeRejection(solved),
          } satisfies Dropped,
        }
      }

      const solvedAt = new Date(now()).toISOString()

      const sample: AlignmentSample = physical
        ? physical.sample(solved, {
            capturedAt: frame.capturedAt,
            exposureSeconds,
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
        ? await retryRead(() => physical.validate(signal), signal)
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
        dropped: undefined,
        position,
        evidence,
        frame,
        frameId,
        display: prepare(),
        /** Once its correction is published, let this frame's display finish even through Stop. */
        keepDisplay: frameWork.release,
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

  /** Six positions along the RA sweep: the offline model's five equal moves, or the physical mount's five rotations. */
  async function run(signal: AbortSignal) {
    const diagnosticInfo = {
      runId,
      rigId: view.rigId!,
      rigName: view.rigName!,
      cameraId: settings.cameraId,
      telescopeId: settings.telescopeId,
      cameraName: physical?.cameraName ?? 'Configured offline camera',
      exposureSeconds,
    }

    let solver: Solver

    if (options.mode === 'physical') {
      diagnostics = await options.openDiagnostics?.({ ...diagnosticInfo, mode: 'physical' })
      patch({ activity: 'homing' })
      fieldHeightDegrees = (await step('alignment.prepare', () => options.physical.prepare(signal)))
        .fieldHeightDegrees
      solver = options.createSolver(fieldHeightDegrees)
      patch({ activity: 'waiting' })
    } else {
      solver = options.solver
      const initial = await hardware.pointing(settings.telescopeId, signal)
      diagnostics = await options.openDiagnostics?.({
        ...diagnosticInfo,
        mode: 'offline',
        simulator: { latitudeDegrees: initial.latitudeDegrees, siderealTimeDegrees: initial.siderealTimeDegrees, at: new Date(now()).toISOString() },
      })

      if (initial.coordinateSystem !== 'j2000' || !initial.tracking)
        throw new Error('The configured simulator’s J2000 frame and tracking are required')

      if (
        initial.rightAscensionDegrees < 8 ||
        initial.rightAscensionDegrees > 52 ||
        Math.abs(initial.declinationDegrees - 60) > 0.01
      ) {
        throw new Error('Reset the simulator to its northern alignment position before measuring')
      }

      // A wide sweep limits amplification of subpixel plate-solve uncertainty.
      // This sweep belongs to the explicitly configured offline model.
      const preparationDegrees = offlineSweep.startDegrees - initial.rightAscensionDegrees

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

    const { fixes, current } = await sweep(solver, signal)
    const latitude = current.latitude
    const fit = fitPolarAxis(fixes.map(fix => sweepFix(fix.position, fix.evidence)), latitude)

    if (!Number.isFinite(fit.verdict.missArcmin))
      throw new Error('A sweep solve has no usable orientation, so rigidity cannot be judged')

    await diagnostics?.recordFit(
      fixes.map(({ position, sample }) => ({ position, sample })),
      latitude,
      fit,
    )
    signal.throwIfAborted()

    const { status, missArcmin, thresholdArcmin, steps } = fit.verdict

    tracer
      .startSpan('alignment.rigidity', {
        attributes: {
          'alignment.run.id': runId,
          'rig.id': view.rigId,
          'alignment.rigidity.status': status,
          'alignment.rigidity.miss_arcmin': missArcmin,
          'alignment.rigidity.threshold_arcmin': thresholdArcmin,
        },
      })
      .end()

    // A fit that is not rigid has no polar error to show: neither the numbers nor the adjusting loop may follow it.
    if (status === 'not-rigid') {
      patch({
        phase: 'not-rigid',
        activity: 'idle',
        warning: null,
        rigidity: {
          missArcmin,
          thresholdArcmin,
          steps: steps.map(step => ({
            beforePosition: Number(step.labelBefore),
            afterPosition: Number(step.labelAfter),
          })),
        },
      })

      return
    }

    patch({ phase: 'adjusting' })
    await adjust(solver, signal, baselineFromAxis(fit.axis, current.sample, latitude), current)
  }

  /**
   * Take a fix at each position of the sweep. A position that gives no fix is written down and skipped; the run
   * stops as soon as the fit can no longer have the fixes it needs.
   */
  async function sweep(solver: Solver, signal: AbortSignal) {
    const fixes: SolvedFrame[] = []
    const dropped: { position: number; detail: string }[] = []

    for (let position = 1; position <= SWEEP_POSITIONS; position++) {
      if (position > 1) {
        patch({ activity: 'moving', position, solvedPositions: fixes.length })

        if (physical)
          await step('alignment.move', () => physical.move(signal), {
            'alignment.position': position,
          })
        else await hardware.move(settings.telescopeId, 1.5, offlineSweep.stepDegrees / 1.5, signal)
      }

      const attempt = await acquire(solver, signal, false)

      if (attempt.dropped) {
        signal.throwIfAborted()
        dropped.push({ position, detail: describeDropped(attempt.dropped) })
        patch({
          dropped: [...dropped],
          warning: `${describeDropped(attempt.dropped)}. Skipping position ${position}.`,
        })

        // The adjusting baseline is a frame taken where the mount now points, so the last position cannot be skipped.
        const reachable = fixes.length + SWEEP_POSITIONS - position >= minimumFixes

        if (!reachable || position === SWEEP_POSITIONS)
          throw new Error(
            `${reachable ? 'The last sweep position gave no fix, and the adjusting baseline needs one taken where the mount now points.' : `Only ${fixes.length} of ${SWEEP_POSITIONS} sweep positions gave a usable fix and the polar fit needs ${minimumFixes}.`} ${dropped.map(drop => `Position ${drop.position}: ${drop.detail}.`).join(' ')}`,
          )

        continue
      }

      fixes.push(attempt)
    }

    patch({ solvedPositions: fixes.length })

    return { fixes, current: fixes.at(-1)! }
  }

  /** Measure the polar error of each new exposure against the fitted axis until Stop. */
  async function adjust(
    solver: Solver,
    signal: AbortSignal,
    baseline: ReturnType<typeof baselineFromAxis>,
    first: SolvedFrame,
  ) {
    let current = first

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
      // A published correction keeps its image: Stop waits for this bounded display work.
      current.keepDisplay()
      current.timing.published('measurement', current.frameRecord)

      // A calm adjustment window between exposures; never infer solver progress from
      // elapsed time. It is also the settling allowance before the next exposure.
      while (true) {
        await waitForNextExposure(signal)
        const attempt = await acquire(solver, signal, true)

        if (!attempt.dropped) {
          current = attempt
          break
        }

        patch({ warning: `${describeDropped(attempt.dropped)}. Trying a new image.`, activity: 'waiting' })
      }
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

/** A sweep position or an adjusting exposure that gave no usable frame. */
type Dropped = { reason: DroppedReason; detail: string }

function describeDropped({ reason, detail }: Dropped) {
  return reason === 'capture-failed' ? `The exposure failed (${detail})` : `Plate-solving failed (${detail})`
}

/** The offline model's RA sweep in J2000 degrees: five equal moves, the span its three-point baseline covered. */
const offlineSweep = { startDegrees: 12, stepDegrees: 7.2 }

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
