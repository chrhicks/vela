import { randomUUID } from 'node:crypto'
import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import { setTimeout as delay } from 'node:timers/promises'
import type { AlignmentView } from '@vela/model/web'
import type { AlpacaAcquisition } from '@vela/alpaca'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample } from './geometry.js'
import { createAstapSolver, projectSky } from './solver.js'
import { previewPng } from '../imaging/preview.js'
import type { PhysicalAlignment } from './physical.js'

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
}

type Solver = ReturnType<typeof createAstapSolver>

export type AlignmentControllerOptions = {
  settings: Pick<AlignmentSettings, 'cameraId' | 'telescopeId' | 'exposureSeconds' | 'fieldHeightDegrees'>
  hardware: AlpacaAcquisition
  now?: () => number
} & (
  | { mode: 'offline'; solver: Solver }
  | { mode: 'physical'; physical: PhysicalAlignment; createSolver: (fieldHeightDegrees: number) => Solver }
)

export function createAlignmentController(options: AlignmentControllerOptions) {
  const { settings, hardware, now = Date.now } = options
  const physical = options.mode === 'physical' ? options.physical : undefined
  let fieldHeightDegrees = settings.fieldHeightDegrees

  let view: AlignmentView = {
    rigId: '', rigName: '', enabled: true, unavailableReason: null,
    phase: 'setup', activity: 'idle', active: false, position: 0, solvedPositions: 0,
    exposureSeconds: settings.exposureSeconds, exposureStartedAt: null, measuredAt: null,
    warning: null, error: null, measurement: null,
    ...(physical ? { mode: 'physical' as const, cameraName: physical.cameraName } : {}),
  }

  const tracer = trace.getTracer('vela.alignment')
  let runId = ''

  async function step<T>(name: string, work: () => Promise<T>, attributes: Attributes = {}): Promise<T> {
    return tracer.startActiveSpan(name, { attributes: { 'alignment.run.id': runId, 'rig.id': view.rigId, ...attributes } }, async span => {
      try {
        return await work()
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') span.setAttribute('operation.cancelled', true)
        else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Alignment failed' })

          if (error instanceof Error) span.recordException(error)
        }

        throw error
      } finally {
        span.end()
      }
    })
  }

  let running: Promise<void> | undefined
  let controller: AbortController | undefined
  let previousSample: AlignmentSample | undefined
  const images = new Map<string, Buffer>()

  function patch(next: Partial<AlignmentView>) { view = { ...view, ...next } }

  async function start(rigId: string, rigName: string, onSettled?: () => void) {
    if (running) throw new Error('A measurement is already running')
    controller = new AbortController()
    previousSample = undefined
    patch({ rigId, rigName, active: true, phase: 'baseline', activity: 'idle', position: 1,
      solvedPositions: 0, measurement: null, measuredAt: null, error: null, warning: null })
    runId = randomUUID()
    const signal = controller.signal
    running = step('alignment.run', async () => {
      // An ended marker makes a new run visible before its long root span ends.
      tracer.startSpan('alignment.started', { attributes: { 'alignment.run.id': runId, 'rig.id': rigId } }).end()
      await run(signal)
    }).catch(error => {
      if (!(error instanceof Error && error.name === 'AbortError')) patch({ phase: 'failed', error: error instanceof Error ? error.message : 'Alignment failed' })
    }).finally(() => {
      patch({ active: false, activity: 'idle', exposureStartedAt: null })
      running = undefined
      onSettled?.()
    })

    return view
  }

  async function stop(finished = false) {
    if (running) {
      patch({ activity: 'stopping' })
      await step('alignment.stop.requested', async () => { controller?.abort() })
      await running
    }

    if (view.phase !== 'failed') patch({ phase: finished && view.measurement ? 'finished' : 'stopped' })

    return view
  }

  async function acquire(solver: Solver, signal: AbortSignal) {
    const actual = physical ? await physical.pointing(signal) : undefined
    const pointing = actual ? undefined : await hardware.pointing(settings.telescopeId, signal)
    const pointingObservedAt = now()

    if (pointing && pointing.coordinateSystem !== 'j2000') throw new Error('This configured alignment model requires the simulator’s J2000 coordinate frame')

    if (pointing && !pointing.tracking) throw new Error('Tracking must be enabled before measuring alignment')
    patch({ activity: 'exposing', exposureStartedAt: new Date().toISOString() })

    const frame = await step('alignment.capture', () => hardware.capture({ cameraId: settings.cameraId, exposureSeconds: settings.exposureSeconds, signal,
      ...(physical ? { expectedCameraName: physical.cameraName } : { monochromeOnly: true }) }), { 'alignment.position': view.position })

    signal.throwIfAborted()

    if (physical) await physical.validate(signal, frame)
    patch({ activity: 'solving', exposureStartedAt: null })
    const solved = await step('alignment.solve', () => solver.solve(frame, actual?.hint ?? { raDegrees: pointing!.rightAscensionDegrees, decDegrees: pointing!.declinationDegrees }, signal), { 'alignment.position': view.position })
    signal.throwIfAborted()

    if (solved.status === 'no-solution') {
      patch({ warning: 'Plate-solving failed. Trying a new image.' })

      return undefined
    }

    patch({ warning: null })

    const sample: AlignmentSample = physical ? physical.sample(solved, { capturedAt: frame.capturedAt, exposureSeconds: settings.exposureSeconds }) : { raDegrees: solved.raDegrees, decDegrees: solved.decDegrees,
      capturedAt: frame.capturedAt, siderealTimeDegrees: (pointing!.siderealTimeDegrees
        + (Date.parse(frame.capturedAt) - pointingObservedAt) / 1000 * 360 / 86164.0905 + 360) % 360 }

    if (previousSample) {
      const elapsed = (Date.parse(sample.capturedAt) - Date.parse(previousSample.capturedAt)) / 1000
      const expected = elapsed * 360 / 86164.0905
      const observed = ((sample.siderealTimeDegrees - previousSample.siderealTimeDegrees + 540) % 360) - 180

      if (elapsed <= 0 || Math.abs(observed - expected) > 0.01) throw new Error('The rig clock or simulator baseline changed. Stop and measure again.')
    }

    previousSample = sample

    return { frame, solved, sample, latitude: actual?.latitude ?? pointing!.latitudeDegrees }
  }

  async function solvedFrame(solver: Solver, signal: AbortSignal) {
    while (true) {
      const result = await acquire(solver, signal)

      if (result) return result
      patch({ activity: 'waiting' })
      await delay(3000, undefined, { signal })
    }
  }

  async function run(signal: AbortSignal) {
    let solver: Solver

    if (options.mode === 'physical') {
      patch({ activity: 'homing' })
      fieldHeightDegrees = (await step('alignment.prepare', () => options.physical.prepare(signal))).fieldHeightDegrees
      solver = options.createSolver(fieldHeightDegrees)
      patch({ activity: 'waiting' })
    } else {
      solver = options.solver
      const initial = await hardware.pointing(settings.telescopeId, signal)

      if (initial.coordinateSystem !== 'j2000' || !initial.tracking) throw new Error('The configured simulator’s J2000 frame and tracking are required')

      if (initial.rightAscensionDegrees < 8 || initial.rightAscensionDegrees > 52 || Math.abs(initial.declinationDegrees - 60) > 0.01) throw new Error('Reset the simulator to its northern alignment position before measuring')
      // A wide baseline limits amplification of subpixel plate-solve uncertainty.
      // This sweep belongs to the explicitly configured offline model.
      const preparationDegrees = 12 - initial.rightAscensionDegrees

      if (Math.abs(preparationDegrees) > 0.1) {
        patch({ activity: 'moving' })
        await hardware.move(settings.telescopeId, Math.sign(preparationDegrees) * 1.5, Math.abs(preparationDegrees) / 1.5, signal)
      }
    }

    const first = await solvedFrame(solver, signal)
    const samples: AlignmentSample[] = [first.sample]
    let current = first

    for (let position = 2; position <= 3; position++) {
      patch({ activity: 'moving', position, solvedPositions: position - 1 })

      if (physical) await step('alignment.move', () => physical.move(signal), { 'alignment.position': position })
      else await hardware.move(settings.telescopeId, 1.5, 12, signal)
      current = await solvedFrame(solver, signal)
      samples.push(current.sample)
    }

    const baseline = createAlignmentBaseline(samples as [AlignmentSample, AlignmentSample, AlignmentSample], first.latitude)
    patch({ phase: 'adjusting', solvedPositions: 3 })

    while (true) {
      const measured = measureAlignment(baseline, current.sample, true)
      const imageId = randomUUID()
      const preview = await step('alignment.preview', () => previewPng(current.frame.width, current.frame.height, current.frame.pixels, current.frame.color))
      signal.throwIfAborted()

      if (physical) await physical.validate(signal)
      images.set(imageId, preview)

      while (images.size > 4) images.delete(images.keys().next().value!)
      const target = physical ? physical.project(current.solved.wcs, measured.correctionTarget, current.sample) : projectSky(current.solved.wcs, measured.correctionTarget)

      if (!target) throw new Error('Alignment target is outside the solvable camera projection')
      patch({ measuredAt: current.frame.capturedAt, activity: 'waiting', measurement: {
        altitudeArcsec: measured.altitudeArcsec, azimuthArcsec: measured.azimuthArcsec,
        totalArcsec: measured.totalArcsec, imageUrl: `/api/rigs/${encodeURIComponent(view.rigId)}/alignment/images/${imageId}`,
        imageWidth: current.frame.width, imageHeight: current.frame.height,
        targetX: target.x, targetY: target.y, fieldHeightDegrees,
        ...(current.frame.capturedAtSource ? { capturedAtSource: current.frame.capturedAtSource } : {}),
      } })
      // A calm adjustment window between exposures; never infer solver progress from elapsed time.
      await delay(3000, undefined, { signal })
      current = await solvedFrame(solver, signal)
    }
  }

  return { start, stop, snapshot: () => view, image: (id: string) => images.get(id), active: () => !!running }
}
