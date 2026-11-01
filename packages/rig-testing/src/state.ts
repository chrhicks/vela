import { Schema } from 'effect'
import { State, type ReadingsOf } from '@vela/rig-events'
import { syntheticSite } from './site.ts'

export interface MountOptions {
  readonly at: number
  readonly raHours: number
  readonly decDegrees: number
  readonly slewing?: boolean
  readonly tracking?: boolean
  readonly pierSide?: 'east' | 'west' | 'unknown'
  readonly frame?: 'topocentric' | 'j2000'
  readonly site?: { readonly latitudeDegrees: number; readonly longitudeDegrees: number; readonly elevationMeters: number } | null
  readonly status?: 'fresh' | 'stale'
}

export const defaultInstanceId = '11111111-1111-4111-8111-111111111111'

export const defaultBindingId = '22222222-2222-4222-8222-222222222222'

export function mountReadings(options: MountOptions): ReadingsOf<'mount'> {
  const status = options.status ?? 'fresh'
  const reading = <T>(value: T) => ({ status, value, observedAt: options.at })
  const site = options.site === undefined ? syntheticSite : options.site
  const siteReading = (pick: (value: typeof syntheticSite) => number) => (site === null ? ({ status: 'unavailable', reason: 'not-read' } as const) : reading(pick(site)))

  return {
    connected: reading(true),
    name: reading('Synthetic mount'),
    rightAscensionHours: reading(options.raHours),
    declinationDegrees: reading(options.decDegrees),
    siderealTimeHours: reading(0),
    slewing: reading(options.slewing ?? false),
    tracking: reading(options.tracking ?? true),
    parked: reading(false),
    trackingRate: reading('sidereal' as const),
    rightAscensionRateSecondsPerSiderealSecond: reading(0),
    declinationRateArcsecondsPerSecond: reading(0),
    pierSide: reading(options.pierSide ?? 'east'),
    coordinateSystem: reading(options.frame ?? 'topocentric'),
    latitudeDegrees: siteReading(value => value.latitudeDegrees),
    longitudeDegrees: siteReading(value => value.longitudeDegrees),
    elevationMeters: siteReading(value => value.elevationMeters),
    canSlew: reading(true),
    canSetTracking: reading(true),
    canFindHome: reading(true),
    canPark: reading(true),
    canUnpark: reading(true),
    canMovePrimaryAxis: reading(true),
    primaryAxisRates: reading([]),
  }
}

export interface StateOptions {
  readonly mount: MountOptions
  readonly sequence: number
  readonly generatedAt?: number
  readonly instanceId?: string
  readonly bindingId?: string
  readonly lost?: boolean
  readonly withoutMount?: boolean
  readonly operations?: readonly object[]
}

function mountDevice(options: StateOptions) {
  return {
    id: 'mount',
    kind: 'mount',
    name: 'Synthetic mount',
    bindingId: options.bindingId ?? defaultBindingId,
    failureDomain: 'mount',
    availability: options.lost ? { ready: false, reason: 'disconnected', message: 'unplugged' } : { ready: true },
    quarantine: { held: false },
    afterOperation: null,
    readings: mountReadings(options.mount),
  }
}

export function mountState(options: StateOptions) {
  return Schema.decodeUnknownSync(State)({
    protocolVersion: 5,
    instanceId: options.instanceId ?? defaultInstanceId,
    sequence: options.sequence,
    generatedAt: options.generatedAt ?? options.mount.at,
    commandsEnabled: false,
    devices: options.withoutMount ? [] : [mountDevice(options)],
    operations: options.operations ?? [],
  })
}
