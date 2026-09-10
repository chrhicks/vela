import { randomUUID } from 'node:crypto'
import type { FramingView, TargetPosition } from '@vela/model/web'
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
  latitudeDegrees?: number
  longitudeDegrees?: number
  elevationMeters?: number
}

export interface FramingHardware {
  status(signal?: AbortSignal): Promise<FramingMount>
  tracking(enabled: boolean, signal: AbortSignal): Promise<void>
  slew(position: TargetPosition, frame: string, signal: AbortSignal): Promise<void>
  capture(seconds: number, signal: AbortSignal): Promise<MonoFrame>
}

export function mountSite(mount: FramingMount): Site {
  if (mount.latitudeDegrees === undefined || mount.longitudeDegrees === undefined) throw new Error('The mount has not supplied an observing location.')

  return { latitudeDegrees: mount.latitudeDegrees, longitudeDegrees: mount.longitudeDegrees,
    ...(mount.elevationMeters === undefined ? {} : { elevationMeters: mount.elevationMeters }) }
}

function fixedPointing(mount: FramingMount) {
  return fromMount({ raDegrees: mount.rightAscensionDegrees, decDegrees: mount.declinationDegrees }, mount.coordinateSystem, new Date(mount.observedAt), mountSite(mount))
}

interface FramingCheck {
  actual: FramingView['actual']
  pointing: TargetPosition | undefined
  configuration: string | undefined
}

function isCheckCurrent(check: FramingCheck, mount: FramingMount, configuration: string, at: Date): boolean {
  return !!check.actual && !!check.pointing
    && check.configuration === configuration
    && mount.tracking && !mount.slewing && !mount.parked
    && at.getTime() - Date.parse(check.actual.capturedAt) < 15 * 60_000
    && angularDistance(fixedPointing(mount), check.pointing) < 0.02
}

function isCenteringEligible(check: FramingCheck, mount: FramingMount, configuration: string, at: Date): boolean {
  return isCheckCurrent(check, mount, configuration, at)
    && !!check.actual && check.actual.offsetArcminutes > 0.5 && check.actual.offsetArcminutes <= 120
}

/** A single user-requested movement/exposure/solve. No durable run or retry loop. */
export function createFramingController(now = () => new Date()) {
  let state: Pick<FramingView, 'phase' | 'active' | 'desired' | 'targetId' | 'actual' | 'error' | 'exposureSeconds'> = {
    phase: 'idle', active: false, desired: null, targetId: null, actual: null, error: null, exposureSeconds: 2,
  }

  let abort: AbortController | undefined
  let pending: Promise<void> | undefined
  let checkedPointing: TargetPosition | undefined
  let checkedConfiguration: string | undefined

  function checkSnapshot(): FramingCheck {
    return { actual: state.actual, pointing: checkedPointing, configuration: checkedConfiguration }
  }

  function checkCurrent(mount: FramingMount, configuration: string): boolean {
    return !state.active && state.phase === 'checked'
      && isCheckCurrent(checkSnapshot(), mount, configuration, now())
  }

  function canCenter(mount: FramingMount, configuration: string): boolean {
    return !state.active && state.phase === 'checked'
      && isCenteringEligible(checkSnapshot(), mount, configuration, now())
  }

  function start(input: { desired: TargetPosition, targetId: string, exposureSeconds: number, configuration: string, center?: boolean }, hardware: FramingHardware, solver: PlateSolver, release: () => void) {
    if (state.active) throw new Error('Framing is already active')
    const previousCheck = checkSnapshot()
    abort = new AbortController()
    const signal = abort.signal
    state = { ...state, actual: input.targetId === state.targetId ? state.actual : null,
      desired: input.desired, targetId: input.targetId, exposureSeconds: input.exposureSeconds, active: true, phase: 'slewing', error: null }
    pending = (async () => {
      try {
        const mount = await hardware.status(signal)

        if (mount.parked || mount.slewing) throw new Error(mount.parked ? 'Unpark the mount before framing.' : 'The mount is already moving.')
        const site = mountSite(mount)
        let destination = input.desired

        if (input.center) {
          // Evaluate against the check snapshot before this operation became active.
          if (!isCenteringEligible(previousCheck, mount, input.configuration, now())) {
            throw new Error('The framing check is no longer current. Slew and check again before centering.')
          }

          destination = correctedPointing(fixedPointing(mount), previousCheck.actual!, input.desired)
        }

        const driverPosition = toMount(destination, mount.coordinateSystem, now(), site)

        if (!mount.tracking) await hardware.tracking(true, signal)
        await hardware.slew(driverPosition, mount.coordinateSystem, signal)
        signal.throwIfAborted()
        const landed = await hardware.status(signal)

        if (landed.slewing || !landed.tracking) throw new Error('The mount has not confirmed stopped movement with tracking enabled.')
        state = { ...state, phase: 'exposing' }
        const frame = await hardware.capture(input.exposureSeconds, signal)
        signal.throwIfAborted()
        state = { ...state, phase: 'solving' }
        const solved = await solver.solve(frame, input.desired, signal)
        signal.throwIfAborted()

        if (solved.status !== 'solved') throw new Error('The test exposure could not be plate solved. Check the image, focus, exposure and sky conditions before trying again.')
        const finalMount = await hardware.status(signal)

        if (finalMount.slewing || !finalMount.tracking || angularDistance(fixedPointing(finalMount), fixedPointing(landed)) >= 0.02) throw new Error('The mount changed during the framing check. Its current frame is unconfirmed.')
        checkedPointing = fixedPointing(finalMount)
        checkedConfiguration = input.configuration
        state = { ...state, phase: 'checked', actual: {
          checkId: randomUUID(),
          raDegrees: solved.raDegrees, decDegrees: solved.decDegrees, capturedAt: solved.capturedAt,
          corners: plateCorners(solved.wcs), rotationDegrees: -Math.atan2(solved.wcs.cd[1], solved.wcs.cd[3]) * 180 / Math.PI,
          offsetArcminutes: angularDistance(input.desired, solved) * 60,
        } }
      } catch (error) {
        const cancelled = signal.aborted && error instanceof Error && error.name === 'AbortError'
        state = { ...state, phase: cancelled ? 'stopped' : 'failed', error: cancelled ? null : error instanceof Error ? error.message : 'Framing failed' }
      } finally {
        state = { ...state, active: false }
        release()
      }
    })()

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

/** Apply the measured small sky rotation to the mount's current requested point.
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

  if (cosine < 0.99) throw new Error('The measured pointing offset is too large for a centering correction.')
  const first = cross(axis, point), second = cross(axis, first)
  const corrected = point.map((v, i) => v + first[i]! + second[i]! / (1 + cosine))

  return { raDegrees: (Math.atan2(corrected[1]!, corrected[0]!) * 180 / Math.PI + 360) % 360,
    decDegrees: Math.atan2(corrected[2]!, Math.hypot(corrected[0]!, corrected[1]!)) * 180 / Math.PI }
}
