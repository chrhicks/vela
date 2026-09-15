import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
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
}

function isCheckCurrent(check: FramingCheck, mount: FramingMount, configuration: string, at: Date): boolean {
  return !!check.actual && !!check.pointing
    && check.configuration === configuration
    && mount.tracking && !mount.slewing && !mount.parked
    && at.getTime() - Date.parse(check.actual.capturedAt) < 15 * 60_000
    && angularDistance(fixedPointing(mount), check.pointing) < 0.02
}

class FramingCheckNeeded extends Error {}

/** One explicit movement at most, followed by a settled exposure and solve. */
export function createFramingController(now = () => new Date(),
  waitForMountObservation: (signal: AbortSignal) => Promise<void> = signal => delay(1000, undefined, { signal })) {
  let state: Pick<FramingView, 'phase' | 'active' | 'desired' | 'targetId' | 'actual' | 'error' | 'exposureSeconds'> = {
    phase: 'idle', active: false, desired: null, targetId: null, actual: null, error: null, exposureSeconds: 2,
  }

  let abort: AbortController | undefined
  let pending: Promise<void> | undefined
  let checkedPointing: TargetPosition | undefined
  let checkedConfiguration: string | undefined

  async function settledMount(hardware: FramingHardware, signal: AbortSignal) {
    state = { ...state, phase: 'settling' }
    let previous: FramingMount | undefined
    let stableReads = 0

    while (true) {
      signal.throwIfAborted()
      const current = await hardware.status(signal)

      if (current.parked || !current.tracking) throw new FramingCheckNeeded('The mount is parked or tracking is off. Restore tracking, then choose Check current frame.')
      const stable = !current.slewing && (!previous || angularDistance(fixedPointing(current), fixedPointing(previous)) < 0.02)
      stableReads = stable ? stableReads + 1 : 0

      // Some drivers clear Slewing before their coordinate observations settle.
      // Require three consistent observations separated by the polling interval.
      if (stableReads >= 3) return current
      previous = current
      await waitForMountObservation(signal)
    }
  }

  function checkSnapshot(): FramingCheck {
    return { actual: state.actual, pointing: checkedPointing, configuration: checkedConfiguration }
  }

  function checkCurrent(mount: FramingMount, configuration: string): boolean {
    return !state.active && state.phase === 'checked'
      && isCheckCurrent(checkSnapshot(), mount, configuration, now())
  }

  function start(input: { desired: TargetPosition, targetId: string, exposureSeconds: number, configuration: string, action: 'start' | 'center' | 'check' }, hardware: FramingHardware, solver: PlateSolver, release: () => void) {
    if (state.active) throw new Error('Framing is already active')
    const previousCheck = checkSnapshot()
    abort = new AbortController()
    const signal = abort.signal
    state = { ...state, actual: input.targetId === state.targetId ? state.actual : null,
      desired: input.desired, targetId: input.targetId, exposureSeconds: input.exposureSeconds, active: true, phase: input.action === 'check' ? 'settling' : 'slewing', error: null }
    pending = (async () => {
      try {
        const mount = await hardware.status(signal)

        if (mount.parked || mount.slewing) throw new FramingCheckNeeded(mount.parked ? 'Unpark the mount, then choose Check current frame.' : 'The mount is still moving. Wait for it to settle, then choose Check current frame.')
        const site = mountSite(mount)
        let destination = input.desired

        if (input.action === 'center') {
          // Evaluate against the check snapshot before this operation became active.
          if (!isCheckCurrent(previousCheck, mount, input.configuration, now())) {
            throw new FramingCheckNeeded('The last exposure no longer matches the current rig state. Choose Check current frame before centering your composition.')
          }

          destination = correctedPointing(fixedPointing(mount), previousCheck.actual!, input.desired)
        }

        const correctionNeeded = input.action !== 'center' || angularDistance(previousCheck.actual!, input.desired) * 60 > 0.5

        if (input.action !== 'check' && correctionNeeded) {
          const driverPosition = toMount(destination, mount.coordinateSystem, now(), site)

          if (!mount.tracking) await hardware.tracking(true, signal)
          await hardware.slew(driverPosition, mount.coordinateSystem, signal)
        }

        while (true) {
          const landed = await settledMount(hardware, signal)
          signal.throwIfAborted()
          state = { ...state, phase: 'exposing', error: null }
          const frame = await hardware.capture(input.exposureSeconds, signal)
          signal.throwIfAborted()
          state = { ...state, phase: 'solving' }
          const solved = await solver.solve(frame, input.desired, signal)
          signal.throwIfAborted()

          if (solved.status !== 'solved') throw new FramingCheckNeeded('This exposure could not be solved. Adjust the test exposure if needed, then choose Check current frame. Your composition is kept.')
          state = { ...state, actual: {
            checkId: randomUUID(),
            raDegrees: solved.raDegrees, decDegrees: solved.decDegrees, capturedAt: solved.capturedAt,
            corners: plateCorners(solved.wcs), rotationDegrees: -Math.atan2(solved.wcs.cd[1], solved.wcs.cd[3]) * 180 / Math.PI,
            offsetArcminutes: angularDistance(input.desired, solved) * 60,
          } }
          const finalMount = await hardware.status(signal)
          signal.throwIfAborted()
          const changedDegrees = angularDistance(fixedPointing(finalMount), fixedPointing(landed))

          if (finalMount.slewing || !finalMount.tracking || changedDegrees >= 0.02) {
            state = { ...state, phase: 'settling', error: `The mount’s position readings changed by ${(changedDegrees * 60).toFixed(1)}′ during the check. Keeping the solved exposure and waiting for stable readings before another exposure.` }
            await waitForMountObservation(signal)
            continue
          }

          checkedPointing = fixedPointing(finalMount)
          checkedConfiguration = input.configuration
          state = { ...state, phase: 'checked', error: null }

          return
        }
      } catch (error) {
        const cancelled = signal.aborted && error instanceof Error && error.name === 'AbortError'
        state = { ...state, phase: cancelled ? 'stopped' : error instanceof FramingCheckNeeded ? 'needs-check' : 'failed', error: cancelled ? null : error instanceof Error ? error.message : 'Framing failed' }
      } finally {
        state = { ...state, active: false }
        release()
      }
    })()

    return structuredClone(state)
  }

  return {
    snapshot: () => structuredClone(state), canCenter: checkCurrent, checkCurrent, start,
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
