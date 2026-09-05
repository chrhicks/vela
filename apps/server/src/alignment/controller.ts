import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { AlignmentView } from '@vela/model/web'
import type { AlpacaAcquisition } from '@vela/alpaca'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample } from './geometry.js'
import { createAstapSolver, projectSky } from './solver.js'
import { previewPng } from '../imaging/preview.js'

export interface AlignmentSettings {
  endpoint: string
  cameraId: string
  telescopeId: string
  executable: string
  catalogPath: string
  exposureSeconds: number
  fieldHeightDegrees: number
}

type Solver = ReturnType<typeof createAstapSolver>
export function createAlignmentController(settings: AlignmentSettings, hardware: AlpacaAcquisition, solver: Solver, now = Date.now) {
  let view: AlignmentView = {
    rigId: '', rigName: '', enabled: true, unavailableReason: null,
    phase: 'setup', activity: 'idle', active: false, position: 0, solvedPositions: 0,
    exposureSeconds: settings.exposureSeconds, exposureStartedAt: null, measuredAt: null,
    warning: null, error: null, measurement: null,
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
    running = run(controller.signal).catch(error => {
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
      controller?.abort()
      await running
    }
    if (view.phase !== 'failed') patch({ phase: finished && view.measurement ? 'finished' : 'stopped' })
    return view
  }

  async function acquire(signal: AbortSignal) {
    const pointing = await hardware.pointing(settings.telescopeId, signal)
    const pointingObservedAt = now()
    if (pointing.coordinateSystem !== 'other') throw new Error('This configured alignment model requires the synthetic equatorial frame')
    if (!pointing.tracking) throw new Error('Tracking must be enabled before measuring alignment')
    patch({ activity: 'exposing', exposureStartedAt: new Date().toISOString() })
    const frame = await hardware.capture({ cameraId: settings.cameraId, exposureSeconds: settings.exposureSeconds, signal })
    signal.throwIfAborted()
    patch({ activity: 'solving', exposureStartedAt: null })
    const solved = await solver.solve(frame, { raDegrees: pointing.rightAscensionDegrees, decDegrees: pointing.declinationDegrees }, signal)
    signal.throwIfAborted()
    if (solved.status === 'no-solution') {
      patch({ warning: 'Plate-solving failed. Trying a new image.' })
      return undefined
    }
    patch({ warning: null })
    const sample: AlignmentSample = { raDegrees: solved.raDegrees, decDegrees: solved.decDegrees,
      capturedAt: frame.capturedAt, siderealTimeDegrees: (pointing.siderealTimeDegrees
        + (Date.parse(frame.capturedAt) - pointingObservedAt) / 1000 * 360 / 86164.0905 + 360) % 360 }
    if (previousSample) {
      const elapsed = (Date.parse(sample.capturedAt) - Date.parse(previousSample.capturedAt)) / 1000
      const expected = elapsed * 360 / 86164.0905
      const observed = ((sample.siderealTimeDegrees - previousSample.siderealTimeDegrees + 540) % 360) - 180
      if (elapsed <= 0 || Math.abs(observed - expected) > 0.01) throw new Error('The rig clock or simulator baseline changed. Stop and measure again.')
    }
    previousSample = sample
    return { frame, solved, sample, latitude: pointing.latitudeDegrees }
  }

  async function solvedFrame(signal: AbortSignal) {
    while (true) {
      const result = await acquire(signal)
      if (result) return result
      patch({ activity: 'waiting' })
      await delay(3000, undefined, { signal })
    }
  }

  async function run(signal: AbortSignal) {
    const initial = await hardware.pointing(settings.telescopeId, signal)
    if (initial.coordinateSystem !== 'other' || !initial.tracking) throw new Error('The configured synthetic frame and tracking are required')
    if (initial.rightAscensionDegrees < 8 || initial.rightAscensionDegrees > 52) throw new Error('Reset the simulator to its supported northern sky patch before measuring')
    // A wide baseline limits amplification of subpixel plate-solve uncertainty.
    // This sweep belongs to the explicitly configured offline model.
    const preparationDegrees = 12 - initial.rightAscensionDegrees
    if (Math.abs(preparationDegrees) > 0.1) {
      patch({ activity: 'moving' })
      await hardware.move(settings.telescopeId, Math.sign(preparationDegrees) * 1.5, Math.abs(preparationDegrees) / 1.5, signal)
    }
    const first = await solvedFrame(signal)
    const samples: AlignmentSample[] = [first.sample]
    let current = first
    for (let position = 2; position <= 3; position++) {
      patch({ activity: 'moving', position, solvedPositions: position - 1 })
      await hardware.move(settings.telescopeId, 1.5, 12, signal)
      current = await solvedFrame(signal)
      samples.push(current.sample)
    }
    const baseline = createAlignmentBaseline(samples as [AlignmentSample, AlignmentSample, AlignmentSample], first.latitude)
    patch({ phase: 'adjusting', solvedPositions: 3 })
    while (true) {
      const measured = measureAlignment(baseline, current.sample, true)
      const imageId = randomUUID()
      images.set(imageId, previewPng(current.frame.width, current.frame.height, current.frame.pixels))
      while (images.size > 4) images.delete(images.keys().next().value!)
      const target = projectSky(current.solved.wcs, measured.correctionTarget)
      if (!target) throw new Error('Alignment target is outside the solvable camera projection')
      patch({ measuredAt: current.frame.capturedAt, activity: 'waiting', measurement: {
        altitudeArcsec: measured.altitudeArcsec, azimuthArcsec: measured.azimuthArcsec,
        totalArcsec: measured.totalArcsec, imageUrl: `/api/rigs/${encodeURIComponent(view.rigId)}/alignment/images/${imageId}`,
        imageWidth: current.frame.width, imageHeight: current.frame.height,
        targetX: target.x, targetY: target.y, fieldHeightDegrees: settings.fieldHeightDegrees,
      } })
      // A calm adjustment window between exposures; never infer solver progress from elapsed time.
      await delay(3000, undefined, { signal })
      current = await solvedFrame(signal)
    }
  }

  return { start, stop, snapshot: () => view, image: (id: string) => images.get(id), active: () => !!running }
}
