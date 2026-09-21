import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { trace, SpanStatusCode, type Attributes } from '@opentelemetry/api'
import type { FramingCentering, FramingPointingSide, FramingView, TargetPosition } from '@vela/model/web'
import type { MonoFrame, PlateSolver } from '../plate-solving/solver.js'
import { angularDistance, fromMount, plateCorners, toMount, type Site } from './sky.js'

export interface FramingMount {
  rightAscensionDegrees: number
  declinationDegrees: number
  coordinateSystem: string
  tracking: boolean
  slewing: boolean
  parked: boolean
  observedAt: string
  pierSide?: FramingPointingSide
  latitudeDegrees?: number
  longitudeDegrees?: number
  elevationMeters?: number
}

export interface FramingFrame extends MonoFrame {
  /** Omitted by older callers when the camera supplied the timestamp. */
  capturedAtSource?: 'camera' | 'server-estimate'
}

export interface FramingHardware {
  status(signal?: AbortSignal): Promise<FramingMount>
  tracking(enabled: boolean, signal: AbortSignal): Promise<void>
  slew(position: TargetPosition, frame: string, signal: AbortSignal): Promise<void>
  capture(seconds: number, signal: AbortSignal, onReadout?: () => void): Promise<FramingFrame>
}

export function mountSite(mount: FramingMount): Site {
  if (mount.latitudeDegrees === undefined || mount.longitudeDegrees === undefined) throw new Error('The mount has not supplied an observing location.')

  const site = { latitudeDegrees: mount.latitudeDegrees, longitudeDegrees: mount.longitudeDegrees }

  return mount.elevationMeters === undefined ? site : { ...site, elevationMeters: mount.elevationMeters }
}

function fixedPointing(mount: FramingMount) {
  return fromMount({ raDegrees: mount.rightAscensionDegrees, decDegrees: mount.declinationDegrees }, mount.coordinateSystem, new Date(mount.observedAt), mountSite(mount))
}

interface FramingCheck {
  actual: FramingView['actual']
  pointing: TargetPosition | undefined
  configuration: string | undefined
  pointingSide: FramingPointingSide
}

function isCheckCurrent(check: FramingCheck, mount: FramingMount, configuration: string, at: Date): boolean {
  return !!check.actual && !!check.pointing
    && check.configuration === configuration
    && check.pointingSide === (mount.pierSide ?? 'unknown')
    && mount.tracking && !mount.slewing && !mount.parked
    && at.getTime() - Date.parse(check.actual.capturedAt) < 15 * 60_000
    && angularDistance(fixedPointing(mount), check.pointing) < 0.02
}

class FramingCheckNeeded extends Error {}

const toleranceArcminutes = 0.5

const maxCorrections = 4

function sideChanged(before: FramingPointingSide, after: FramingPointingSide) {
  return before !== 'unknown' && after !== 'unknown' && before !== after
}

/** Short completed records survive while the parent operation is still running. */
function recordFraming(name: string, attributes: Attributes) {
  trace.getTracer('vela.framing').startSpan(name, { attributes }).end()
}

/** One server-owned request. Every corrective movement earns a fresh solved check. */
export function createFramingController(now = () => new Date(),
  waitForMountObservation: (signal: AbortSignal) => Promise<void> = signal => delay(1000, undefined, { signal })) {
  let state: Pick<FramingView, 'phase' | 'active' | 'desired' | 'targetId' | 'actual' | 'error' | 'exposureSeconds' | 'pointingSide' | 'centering'> = {
    phase: 'idle', active: false, desired: null, targetId: null, actual: null, error: null, exposureSeconds: 2,
    pointingSide: 'unknown', centering: null,
  }

  let abort: AbortController | undefined
  let pending: Promise<void> | undefined
  let checkedPointing: TargetPosition | undefined
  let checkedConfiguration: string | undefined
  let checkedSide: FramingPointingSide = 'unknown'

  async function observe(hardware: FramingHardware, signal: AbortSignal) {
    const mount = await hardware.status(signal)
    signal.throwIfAborted()
    state = { ...state, pointingSide: mount.pierSide ?? 'unknown' }

    return mount
  }

  async function settledMount(hardware: FramingHardware, signal: AbortSignal) {
    state = { ...state, phase: 'settling' }
    let previous: FramingMount | undefined
    let stableReads = 0

    while (true) {
      signal.throwIfAborted()
      const current = await observe(hardware, signal)

      if (current.parked || !current.tracking) throw new FramingCheckNeeded('The mount is parked or tracking is off. Restore tracking, then choose Check current frame.')

      const stable = !current.slewing && (!previous || ((current.pierSide ?? 'unknown') === (previous.pierSide ?? 'unknown')
        && angularDistance(fixedPointing(current), fixedPointing(previous)) < 0.02))

      stableReads = stable ? stableReads + 1 : 0

      // Some drivers clear Slewing before their coordinate observations settle.
      // Require three consistent observations separated by the polling interval.
      if (stableReads >= 3) return current
      previous = current
      await waitForMountObservation(signal)
    }
  }

  function checkSnapshot(): FramingCheck {
    return { actual: state.actual, pointing: checkedPointing, configuration: checkedConfiguration, pointingSide: checkedSide }
  }

  function checkCurrent(mount: FramingMount, configuration: string): boolean {
    return !state.active && state.phase === 'checked'
      && isCheckCurrent(checkSnapshot(), mount, configuration, now())
  }

  function canCenter(mount: FramingMount, configuration: string): boolean {
    return checkCurrent(mount, configuration)
      && state.centering?.outcome !== 'not-converging' && state.centering?.outcome !== 'limit-reached'
  }

  async function measure(input: { desired: TargetPosition, exposureSeconds: number, configuration: string }, hardware: FramingHardware, solver: PlateSolver, signal: AbortSignal) {
    while (true) {
      const landed = await settledMount(hardware, signal)
      signal.throwIfAborted()
      state = { ...state, phase: 'exposing', error: null }

      const frame = await hardware.capture(input.exposureSeconds, signal, () => {
        if (!signal.aborted) state = { ...state, phase: 'downloading' }
      })

      signal.throwIfAborted()
      state = { ...state, phase: 'solving' }
      const solved = await solver.solve(frame, input.desired, signal)
      signal.throwIfAborted()

      if (solved.status !== 'solved') throw new FramingCheckNeeded('This exposure could not be solved. Adjust the test exposure if needed, then choose Check current frame. Your composition is kept.')

      const actual = {
        checkId: randomUUID(),
        raDegrees: solved.raDegrees, decDegrees: solved.decDegrees, capturedAt: solved.capturedAt,
        corners: plateCorners(solved.wcs), rotationDegrees: -Math.atan2(solved.wcs.cd[1], solved.wcs.cd[3]) * 180 / Math.PI,
        offsetArcminutes: angularDistance(input.desired, solved) * 60,
      }

      state = { ...state, actual }
      recordFraming('framing.solved', { 'framing.check.id': actual.checkId,
        'framing.solved.ra_degrees': actual.raDegrees, 'framing.solved.dec_degrees': actual.decDegrees,
        'framing.solved.captured_at': actual.capturedAt, 'framing.solved.offset_arcminutes': actual.offsetArcminutes,
        'image.captured_at_source': frame.capturedAtSource ?? 'camera', 'image.color': JSON.stringify(frame.color ?? null),
        'framing.solved.rotation_degrees': actual.rotationDegrees, 'framing.solved.wcs': JSON.stringify(solved.wcs),
        'framing.mount.at_exposure': JSON.stringify(landed), 'framing.correction': state.centering?.correction ?? 0 })
      const finalMount = await observe(hardware, signal)
      const changedDegrees = angularDistance(fixedPointing(finalMount), fixedPointing(landed))

      const matches = !finalMount.parked && !finalMount.slewing && finalMount.tracking && changedDegrees < 0.02
        && (finalMount.pierSide ?? 'unknown') === (landed.pierSide ?? 'unknown')

      recordFraming('framing.check-validation', { 'framing.check.id': actual.checkId, 'framing.check.current': matches,
        'framing.mount.after_exposure': JSON.stringify(finalMount), 'framing.mount.changed_degrees': changedDegrees })

      if (finalMount.parked) throw new FramingCheckNeeded('The mount is parked. Unpark it and check the current frame before continuing.')

      if (!matches) {
        state = { ...state, phase: 'settling', error: 'The mount’s position or pointing side changed during the check. Keeping the solved exposure and waiting for stable readings before another exposure.' }
        await waitForMountObservation(signal)
        continue
      }

      checkedPointing = fixedPointing(finalMount)
      checkedConfiguration = input.configuration
      checkedSide = finalMount.pierSide ?? 'unknown'

      return { actual, mount: finalMount }
    }
  }

  async function move(destination: TargetPosition, mount: FramingMount, hardware: FramingHardware, signal: AbortSignal) {
    signal.throwIfAborted()
    state = { ...state, phase: 'slewing' }
    const convertedAt = now()
    const driverPosition = toMount(destination, mount.coordinateSystem, convertedAt, mountSite(mount))

    if (!mount.tracking) await hardware.tracking(true, signal)
    signal.throwIfAborted()
    recordFraming('framing.move.requested', { 'framing.correction': state.centering?.correction ?? 0,
      'framing.check.id': state.actual?.checkId ?? '', 'framing.mount.before_move': JSON.stringify(mount),
      'framing.command.j2000': JSON.stringify(destination), 'framing.command.driver': JSON.stringify(driverPosition),
      'framing.command.coordinate_system': mount.coordinateSystem, 'framing.command.converted_at': convertedAt.toISOString() })
    await hardware.slew(driverPosition, mount.coordinateSystem, signal)
    signal.throwIfAborted()
    recordFraming('framing.move.completed', { 'framing.correction': state.centering?.correction ?? 0 })
  }

  function recordMeasurement(actual: NonNullable<FramingView['actual']>, correction: number, previous?: FramingCentering['measurements'][number]): FramingCentering['measurements'][number] {
    let trend: FramingCentering['measurements'][number]['trend'] = 'starting'

    if (previous) {
      trend = 'unchanged'

      if (actual.offsetArcminutes < previous.offsetArcminutes) trend = 'improved'

      if (actual.offsetArcminutes > previous.offsetArcminutes) trend = 'worsened'

      if (actual.offsetArcminutes <= toleranceArcminutes) trend = 'within-tolerance'
    }

    return { correction, checkId: actual.checkId, capturedAt: actual.capturedAt, offsetArcminutes: actual.offsetArcminutes,
      rotationDegrees: actual.rotationDegrees, pointingSide: checkedSide,
      pointingSideChanged: !!previous && sideChanged(previous.pointingSide, checkedSide), trend }
  }

  function start(input: { desired: TargetPosition, targetId: string, exposureSeconds: number, configuration: string, action: 'start' | 'center' | 'check', rigId?: string, requestId?: string }, hardware: FramingHardware, solver: PlateSolver, release: () => void) {
    if (state.active) throw new Error('Framing is already active')
    const previousCheck = checkSnapshot()
    abort = new AbortController()
    const signal = abort.signal
    state = { ...state, actual: input.targetId === state.targetId ? state.actual : null,
      desired: input.desired, targetId: input.targetId, exposureSeconds: input.exposureSeconds, active: true, phase: input.action === 'check' ? 'settling' : 'slewing', error: null, centering: null }

    const attributes = { 'framing.run.id': randomUUID(), 'framing.action': input.action,
      'rig.id': input.rigId ?? '', 'http.request.id': input.requestId ?? '', 'framing.target.id': input.targetId,
      'framing.desired.ra_degrees': input.desired.raDegrees, 'framing.desired.dec_degrees': input.desired.decDegrees,
      'framing.exposure_seconds': input.exposureSeconds, 'framing.configuration': input.configuration,
      'framing.tolerance_arcminutes': toleranceArcminutes, 'framing.max_corrections': maxCorrections }

    pending = trace.getTracer('vela.framing').startActiveSpan('framing.run', { attributes }, async span => {
      recordFraming('framing.started', attributes)

      try {
        let mount = await observe(hardware, signal)

        if (mount.parked || mount.slewing) throw new FramingCheckNeeded(mount.parked ? 'Unpark the mount, then choose Check current frame.' : 'The mount is still moving. Wait for it to settle, then choose Check current frame.')

        if (input.action !== 'center') {
          if (input.action === 'start') await move(input.desired, mount, hardware, signal)
          await measure(input, hardware, solver, signal)
        } else {
          if (!isCheckCurrent(previousCheck, mount, input.configuration, now())) {
            throw new FramingCheckNeeded('The last exposure no longer matches the current rig state. Choose Check current frame before centering your composition.')
          }

          let actual = { ...previousCheck.actual!, offsetArcminutes: angularDistance(previousCheck.actual!, input.desired) * 60 }
          const progress: FramingCentering = { toleranceArcminutes, maxCorrections, correction: 0, outcome: 'working', measurements: [recordMeasurement(actual, 0)] }
          state = { ...state, actual, centering: progress }
          recordFraming('framing.centering.baseline', { 'framing.check.id': actual.checkId,
            'framing.solved.ra_degrees': actual.raDegrees, 'framing.solved.dec_degrees': actual.decDegrees,
            'framing.solved.captured_at': actual.capturedAt, 'framing.solved.offset_arcminutes': actual.offsetArcminutes,
            'framing.solved.rotation_degrees': actual.rotationDegrees, 'framing.pointing_side': checkedSide,
            'framing.mount.before_centering': JSON.stringify(mount) })
          let consecutiveWorsenings = 0

          while (progress.outcome === 'working') {
            if (actual.offsetArcminutes > toleranceArcminutes) {
              // A fresh observation must still match the solve used for this specific correction.
              mount = await observe(hardware, signal)

              if (!isCheckCurrent(checkSnapshot(), mount, input.configuration, now())) {
                throw new FramingCheckNeeded('The mount changed after the last solve. Choose Check current frame before another correction.')
              }

              progress.correction++
              state = { ...state, centering: progress }
              await move(correctedPointing(fixedPointing(mount), actual, input.desired), mount, hardware, signal)
            }

            actual = (await measure(input, hardware, solver, signal)).actual
            const measurement = recordMeasurement(actual, progress.correction, progress.measurements.at(-1))
            consecutiveWorsenings = progress.correction > 0 && measurement.trend === 'worsened' ? consecutiveWorsenings + 1 : 0
            let outcome: FramingCentering['outcome'] = 'working'

            if (actual.offsetArcminutes <= toleranceArcminutes) outcome = 'centered'
            else if (consecutiveWorsenings >= 2) outcome = 'not-converging'
            else if (progress.correction >= maxCorrections) outcome = 'limit-reached'
            progress.outcome = outcome
            progress.measurements.push(measurement)
            state = { ...state, centering: progress }
            recordFraming('framing.correction.measured', { 'framing.correction': progress.correction,
              'framing.check.id': measurement.checkId, 'framing.offset_arcminutes': measurement.offsetArcminutes,
              'framing.trend': measurement.trend, 'framing.pointing_side': measurement.pointingSide,
              'framing.pointing_side_changed': measurement.pointingSideChanged, 'framing.outcome': outcome })
          }
        }

        state = { ...state, phase: 'checked', error: null }
      } catch (error) {
        const cancelled = signal.aborted && error instanceof Error && error.name === 'AbortError'
        state = { ...state, phase: cancelled ? 'stopped' : error instanceof FramingCheckNeeded ? 'needs-check' : 'failed', error: cancelled ? null : error instanceof Error ? error.message : 'Framing failed' }

        if (state.centering) state = { ...state, centering: { ...state.centering, outcome: 'interrupted' } }

        if (!cancelled) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: state.error ?? 'Framing failed' })

          if (error instanceof Error) span.recordException(error)
        }
      } finally {
        state = { ...state, active: false }
        span.setAttributes({ 'framing.phase': state.phase, 'framing.outcome': state.centering?.outcome ?? state.phase,
          'framing.corrections': state.centering?.correction ?? 0, 'operation.cancelled': signal.aborted })
        span.end()
        release()
      }
    })

    return structuredClone(state)
  }

  return {
    snapshot: () => structuredClone(state), canCenter, checkCurrent, start,
    async stop() {
      if (state.active) {
        state = { ...state, phase: 'stopping' }
        abort?.abort(new DOMException('Framing stopped', 'AbortError'))
      }

      await pending
    },
  }
}

/** Apply the measured sky rotation to the mount's current requested point.
 * Vectors keep RA wrap and polar fields well-defined. No sync changes the mount model.
 */
export function correctedPointing(mount: TargetPosition, actual: TargetPosition, desired: TargetPosition): TargetPosition {
  const toVector = (p: TargetPosition) => {
    const ra = p.raDegrees * Math.PI / 180
    const dec = p.decDegrees * Math.PI / 180

    return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
  }

  const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]
  const a = toVector(actual), b = toVector(desired), point = toVector(mount)
  const axis = cross(a, b)
  const cosine = a.reduce((sum, v, i) => sum + v * b[i]!, 0)

  if (1 + cosine <= 1e-12) throw new FramingCheckNeeded('The composition is opposite the solved field, so its correction direction is ambiguous. Slew & check the new composition first.')
  const first = cross(axis, point), second = cross(axis, first)
  const corrected = point.map((v, i) => v + first[i]! + second[i]! / (1 + cosine))

  return { raDegrees: (Math.atan2(corrected[1]!, corrected[0]!) * 180 / Math.PI + 360) % 360,
    decDegrees: Math.atan2(corrected[2]!, Math.hypot(corrected[0]!, corrected[1]!)) * 180 / Math.PI }
}
