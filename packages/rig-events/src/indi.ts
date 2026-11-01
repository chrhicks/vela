import { Cause, Exit, Schema } from 'effect'
import { seal, type DecodeResult } from './codec.ts'
import type { RigEvent } from './event.ts'
import { parseMessage, type Element, type Message, type Permission, type PropertyState, type Vector } from './indi-message.ts'
import { EpochMs, type RigId, type SourceId } from './primitives.ts'
import { State, type ReadingsOf } from './wire.ts'

const RecordingLine = Schema.Union([
  Schema.Struct({ k: Schema.Literal('msg'), at: EpochMs, dir: Schema.Literals(['in', 'out']), xml: Schema.String }),
  Schema.Struct({ k: Schema.Literals(['conn', 'op', 'gap', 'end']), at: EpochMs }),
])

/** The part of a recording's `manifest.json` the importer needs. */
export const RecordingManifest = Schema.Struct({
  instanceId: Schema.String,
  devices: Schema.Array(Schema.Struct({ id: Schema.String, kind: Schema.String, indiDevice: Schema.String })),
})

export type RecordingManifest = typeof RecordingManifest.Type

export const decodeManifest = Schema.decodeUnknownSync(RecordingManifest)

type MountReadings = ReadingsOf<'mount'>

type Unavailable = { readonly status: 'unavailable'; readonly reason: 'not-read' | 'unsupported' | 'failed'; readonly message?: string }

type Observed<T> = { readonly status: 'fresh' | 'stale'; readonly value: T; readonly observedAt: number } | Unavailable

interface Property {
  readonly kind: Vector['kind']
  readonly state: PropertyState
  readonly perm: Permission
  readonly elements: ReadonlyMap<string, Element>
  readonly receivedAt: number
}

const decodeLine = Schema.decodeUnknownExit(RecordingLine)

const decodeState = Schema.decodeUnknownExit(State)

/** A recording never saw the binding UUID Cria gave the device, so every state carries this placeholder. */
const unknownBindingId = '00000000-0000-4000-8000-000000000000'

/** Every INDI property Cria's `readings` function for a mount reads. A message about any other property changes no reading. */
const readingInputs = new Set([
  'CONNECTION',
  'EQUATORIAL_EOD_COORD',
  'EQUATORIAL_COORD',
  'GEOGRAPHIC_COORD',
  'TIME_LST',
  'TELESCOPE_TRACK_STATE',
  'TELESCOPE_PARK',
  'TELESCOPE_TRACK_MODE',
  'TELESCOPE_TRACK_RATE',
  'TELESCOPE_PIER_SIDE',
  'TELESCOPE_HOME',
  'TELESCOPE_MOTION_WE',
  'TELESCOPE_SLEW_RATE',
])

/** Alert on a command property means the last command failed, not that the value is old. */
const command = { alertMeansStale: false }

const definitionsSettleMs = 2000

const siderealArcsecondsPerSecond = 15.041067

function describe(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause).split('\n').slice(0, 3).join(' | ')
}

function numberElement(property: Property, name: string): number | undefined {
  const element = property.elements.get(name)

  return element?.kind === 'number' ? element.value : undefined
}

function switchElement(property: Property, name: string): boolean | undefined {
  const element = property.elements.get(name)

  return element?.kind === 'switch' ? element.on : undefined
}

function selectedSwitch(property: Property): string | undefined {
  for (const [name, element] of property.elements) if (element.kind === 'switch' && element.on) return name

  return undefined
}

const trackingRates = new Map<string, 'sidereal' | 'lunar' | 'solar'>([
  ['TRACK_SIDEREAL', 'sidereal'],
  ['TRACK_LUNAR', 'lunar'],
  ['TRACK_SOLAR', 'solar'],
])

const pierSides = new Map<string, 'east' | 'west'>([
  ['PIER_EAST', 'east'],
  ['PIER_WEST', 'west'],
])

/** INDI slew rates are named multiples of sidereal ("16x"); unnamed ones are skipped. */
function axisRates(property: Property): { name: string; degreesPerSecond: number }[] {
  const rates: { name: string; degreesPerSecond: number }[] = []

  for (const [name, element] of property.elements) {
    const multiple = /^(\d+(\.\d+)?)x$/i.exec(element.label.trim()) ?? /^(\d+(\.\d+)?)x$/i.exec(name.trim())

    if (multiple) rates.push({ name, degreesPerSecond: (Number(multiple[1]) * siderealArcsecondsPerSecond) / 3600 })
  }

  return rates
}

/** Greenwich mean sidereal time (IAU 1982) plus longitude, as Cria derives it when the mount has no TIME_LST. */
function localSiderealHours(epochMs: number, eastLongitudeDegrees: number): number {
  const daysSinceJ2000 = epochMs / 86_400_000 + 2440587.5 - 2451545.0
  const local = 18.697374558 + 24.06570982441908 * daysSinceJ2000 + eastLongitudeDegrees / 15

  return ((local % 24) + 24) % 24
}

/**
 * Rebuilds the mount's protocol-5 readings from Errai's recorded INDI traffic, the way Cria's `readings` function
 * in `capability/mount.ts` builds them from the live property mirror. One state comes out for each recorded
 * message that changes an input of a mount reading, with `freshness: 'qualified'`. A recording shows the driver
 * answering at each of those instants and nothing in between, so a steady reading is never promised fresh for
 * the time between two messages.
 *
 * Cria's liveness probe is not rebuilt. A reading is `fresh` unless its property is in Alert, and `observedAt` is
 * when the property was last defined or updated. Connection, operation and gap lines carry no mount reading.
 */
export function createIndiImporter(context: { readonly rig: RigId; readonly source: SourceId; readonly manifest: RecordingManifest }) {
  const { rig, source, manifest } = context
  const found = manifest.devices.find(device => device.kind === 'mount')

  if (found === undefined) throw new Error('The recording names no mount')

  const mount: RecordingManifest['devices'][number] = found

  const properties = new Map<string, Property>()
  let connectedSince: number | undefined
  let definedAt: number | undefined
  let sequence = 0

  const isConnected = () => {
    const connection = properties.get('CONNECTION')

    return connection !== undefined && switchElement(connection, 'CONNECT') === true
  }

  function define(vector: Vector, at: number): void {
    if (vector.state === undefined || vector.perm === undefined) throw new Error(`The definition of ${vector.name} lacks a state or a permission`)

    properties.set(vector.name, { kind: vector.kind, state: vector.state, perm: vector.perm, elements: vector.elements, receivedAt: at })
  }

  /** An update for a property never defined, or defined as another kind, cannot be read, as in Cria's mirror. */
  function update(vector: Vector, at: number): boolean {
    const current = properties.get(vector.name)

    if (current === undefined || current.kind !== vector.kind) return false

    const elements = new Map(current.elements)

    for (const [name, element] of vector.elements) {
      const known = elements.get(name)

      if (known !== undefined && known.kind === element.kind) elements.set(name, { ...element, label: known.label })
    }

    properties.set(vector.name, { ...current, state: vector.state ?? current.state, elements, receivedAt: at })

    return true
  }

  /** True when the message changed an input of a mount reading. */
  function apply(message: Message, at: number): boolean {
    if (message.type === 'del') {
      if (message.name !== undefined) return properties.delete(message.name)

      const had = properties.size > 0

      properties.clear()
      connectedSince = undefined

      return had
    }

    const { vector } = message

    if (message.type === 'def' && vector.name !== 'CONNECTION') definedAt = at

    if (!readingInputs.has(vector.name)) return false

    if (message.type === 'def') define(vector, at)
    else if (!update(vector, at)) return false

    if (vector.name === 'CONNECTION') connectedSince = isConnected() ? (connectedSince ?? at) : undefined

    return true
  }

  function readingsAt(at: number): MountReadings {
    const connected = isConnected()
    const settled = connected && connectedSince !== undefined && at - Math.max(connectedSince, definedAt ?? 0) > definitionsSettleMs

    function reading<T>(name: string, extract: (property: Property) => T | undefined, { alertMeansStale = true }: { alertMeansStale?: boolean } = {}): Observed<T> {
      const property = properties.get(name)

      if (property === undefined) {
        if (properties.size === 0) return { status: 'unavailable', reason: 'failed', message: `${mount.indiDevice} is not defined by indiserver` }

        if (!connected) return { status: 'unavailable', reason: 'failed', message: `${mount.indiDevice} is disconnected` }

        return { status: 'unavailable', reason: settled ? 'unsupported' : 'not-read' }
      }

      const value = extract(property)

      if (value === undefined) return { status: 'unavailable', reason: 'unsupported' }

      return { status: property.state === 'Alert' && alertMeansStale ? 'stale' : 'fresh', value, observedAt: property.receivedAt }
    }

    const coordinates = properties.has('EQUATORIAL_EOD_COORD') || !properties.has('EQUATORIAL_COORD')
      ? { name: 'EQUATORIAL_EOD_COORD', frame: 'topocentric' as const }
      : { name: 'EQUATORIAL_COORD', frame: 'j2000' as const }

    const longitude = reading('GEOGRAPHIC_COORD', property => {
      const east = numberElement(property, 'LONG')

      return east === undefined ? undefined : east > 180 ? east - 360 : east
    })

    const siderealTime: Observed<number> = properties.has('TIME_LST')
      ? reading('TIME_LST', property => numberElement(property, 'LST'))
      : longitude.status === 'unavailable'
        ? longitude
        : { ...longitude, value: localSiderealHours(at, longitude.value) }

    const homeElement = (property: Property) => ['GO', 'FIND'].find(name => property.elements.has(name))

    return {
      connected: reading('CONNECTION', property => switchElement(property, 'CONNECT')),
      name: properties.size === 0
        ? { status: 'unavailable', reason: 'failed', message: `${mount.indiDevice} is not defined by indiserver` }
        : { status: 'fresh', value: mount.indiDevice, observedAt: at },
      rightAscensionHours: reading(coordinates.name, property => numberElement(property, 'RA'), command),
      declinationDegrees: reading(coordinates.name, property => numberElement(property, 'DEC'), command),
      siderealTimeHours: siderealTime,
      slewing: reading(coordinates.name, property => property.state === 'Busy', command),
      tracking: reading('TELESCOPE_TRACK_STATE', property => switchElement(property, 'TRACK_ON')),
      parked: reading('TELESCOPE_PARK', property => switchElement(property, 'PARK')),
      trackingRate: reading('TELESCOPE_TRACK_MODE', property => trackingRates.get(selectedSwitch(property) ?? '')),
      rightAscensionRateSecondsPerSiderealSecond: reading('TELESCOPE_TRACK_RATE', property => {
        const rate = numberElement(property, 'TRACK_RATE_RA')

        return rate === undefined ? undefined : ((rate - siderealArcsecondsPerSecond) / 15) * 0.99726957
      }),
      declinationRateArcsecondsPerSecond: reading('TELESCOPE_TRACK_RATE', property => numberElement(property, 'TRACK_RATE_DE')),
      pierSide: reading('TELESCOPE_PIER_SIDE', property => pierSides.get(selectedSwitch(property) ?? '') ?? 'unknown'),
      coordinateSystem: reading(coordinates.name, () => coordinates.frame),
      latitudeDegrees: reading('GEOGRAPHIC_COORD', property => numberElement(property, 'LAT')),
      longitudeDegrees: longitude,
      elevationMeters: reading('GEOGRAPHIC_COORD', property => numberElement(property, 'ELEV')),
      canSlew: reading(coordinates.name, property => property.perm !== 'ro'),
      canSetTracking: reading(coordinates.name, () => properties.get('TELESCOPE_TRACK_STATE')?.perm === 'rw'),
      canFindHome: reading(coordinates.name, () => {
        const home = properties.get('TELESCOPE_HOME')

        return home !== undefined && homeElement(home) !== undefined
      }),
      canPark: reading(coordinates.name, () => properties.has('TELESCOPE_PARK')),
      canUnpark: reading(coordinates.name, () => properties.has('TELESCOPE_PARK')),
      canMovePrimaryAxis: reading(coordinates.name, () => properties.has('TELESCOPE_MOTION_WE')),
      primaryAxisRates: reading('TELESCOPE_SLEW_RATE', axisRates),
    }
  }

  function availabilityOf(readings: MountReadings) {
    if (readings.name.status === 'unavailable') return { ready: false, reason: 'unavailable', message: 'indiserver or the driver is not available' } as const

    if (readings.connected.status !== 'unavailable' && readings.connected.value === false)
      return { ready: false, reason: 'disconnected', message: 'The device is disconnected' } as const

    if (readings.connected.status !== 'fresh') return { ready: false, reason: 'stale', message: 'The driver is not answering' } as const

    return { ready: true } as const
  }

  /** `undefined` for a line that carries no mount reading. */
  function read(text: string): DecodeResult<RigEvent> | undefined {
    let raw: unknown

    try {
      raw = JSON.parse(text)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), raw: text }
    }

    const exit = decodeLine(raw)

    if (!Exit.isSuccess(exit)) return { ok: false, error: describe(exit.cause), raw }

    const line = exit.value

    if (line.k !== 'msg' || line.dir !== 'in') return undefined

    let changed: boolean

    try {
      const message = parseMessage(line.xml)

      if (message === undefined || (message.type === 'del' ? message.device : message.vector.device) !== mount.indiDevice) return undefined

      changed = apply(message, line.at)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), raw: line }
    }

    if (!changed) return undefined

    const readings = readingsAt(line.at)

    const decoded = decodeState({
      protocolVersion: 5,
      instanceId: manifest.instanceId,
      sequence: sequence++,
      generatedAt: line.at,
      commandsEnabled: false,
      devices: [
        {
          id: mount.id,
          kind: 'mount',
          name: mount.indiDevice,
          bindingId: unknownBindingId,
          failureDomain: mount.id,
          availability: availabilityOf(readings),
          quarantine: { held: false },
          afterOperation: null,
          readings,
        },
      ],
      operations: [],
    })

    if (!Exit.isSuccess(decoded)) return { ok: false, error: describe(decoded.cause), raw: line }

    return {
      ok: true,
      event: seal({
        kind: 'cria.state',
        rig,
        source,
        at: line.at,
        seenAt: line.at,
        body: { origin: `indi-recording:${manifest.instanceId}`, freshness: 'qualified', state: decoded.value },
      }),
    }
  }

  return { read }
}
