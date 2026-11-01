import { epochMs, type EpochMs, type State } from '@vela/rig-events'
import type { Site } from '@vela/rig-sky'
import type { PierSide } from './mount-position.ts'

export type MountFrame = 'topocentric' | 'j2000'

export interface MotionOperation {
  readonly id: string
  readonly phase: 'active' | 'settled'
  readonly startedAt: EpochMs
  readonly settledAt: EpochMs | null
  readonly confirmed: boolean
}

export interface PositionReading {
  readonly raHours: number
  readonly decDegrees: number
  readonly frame: MountFrame
  readonly at: EpochMs
  readonly fresh: boolean
}

/** Everything the model takes from one Cria snapshot about the mount, in the model's own terms. */
export interface MountObservation {
  readonly at: EpochMs
  readonly instanceId: string
  readonly bindingId: string
  readonly lost: boolean
  readonly position: PositionReading | null
  readonly slewing: { readonly value: boolean; readonly at: EpochMs } | null
  readonly tracking: boolean | null
  readonly pierSide: PierSide
  readonly site: Site | null
  readonly operations: readonly MotionOperation[]
}

const motionKinds = new Set(['mount-slew', 'mount-axis', 'mount-rotate', 'mount-home', 'mount-park', 'mount-unpark'])

const lostReasons = new Set(['disconnected', 'unavailable', 'stale', 'starting', 'blocked'])

interface Seen<T> {
  readonly value: T
  readonly at: EpochMs
  readonly fresh: boolean
}

type Wire<T> = { readonly status: 'unavailable' } | { readonly status: 'fresh' | 'stale'; readonly value: T; readonly observedAt: number }

function seen<T>(reading: Wire<T>): Seen<T> | null {
  return reading.status === 'unavailable' ? null : { value: reading.value, at: epochMs(reading.observedAt), fresh: reading.status === 'fresh' }
}

function siteOf(latitude: Seen<number> | null, longitude: Seen<number> | null, elevation: Seen<number> | null): Site | null {
  return latitude && longitude ? { latitudeDegrees: latitude.value, longitudeDegrees: longitude.value, elevationMeters: elevation?.value ?? 0 } : null
}

export function observeMount(state: State): MountObservation | null {
  const device = state.devices.find(candidate => candidate.kind === 'mount')

  if (device?.kind !== 'mount') return null

  const { readings } = device
  const ra = seen(readings.rightAscensionHours)
  const dec = seen(readings.declinationDegrees)
  const frame = seen(readings.coordinateSystem)
  const slewing = seen(readings.slewing)
  const tracking = seen(readings.tracking)
  const pier = seen(readings.pierSide)

  return {
    at: epochMs(state.generatedAt),
    instanceId: state.instanceId,
    bindingId: device.bindingId,
    lost: !device.availability.ready && lostReasons.has(device.availability.reason),
    position:
      ra && dec && frame
        ? { raHours: ra.value, decDegrees: dec.value, frame: frame.value, at: epochMs(Math.max(ra.at, dec.at)), fresh: ra.fresh && dec.fresh }
        : null,
    slewing: slewing ? { value: slewing.value, at: slewing.at } : null,
    tracking: tracking ? tracking.value : null,
    pierSide: pier ? pier.value : 'unknown',
    site: siteOf(seen(readings.latitudeDegrees), seen(readings.longitudeDegrees), seen(readings.elevationMeters)),
    operations: state.operations.flatMap((operation): MotionOperation[] => {
      if (operation.deviceId !== device.id || !motionKinds.has(operation.kind)) return []

      switch (operation.state) {
        case 'waiting':
          return []
        case 'running':
          return [{ id: operation.id, phase: 'active', startedAt: epochMs(operation.startedAt), settledAt: null, confirmed: true }]
        case 'settled':
          return [
            {
              id: operation.id,
              phase: 'settled',
              startedAt: epochMs(operation.startedAt),
              settledAt: epochMs(operation.settledAt),
              confirmed: operation.outcome.kind === 'confirmed',
            },
          ]
      }
    }),
  }
}
