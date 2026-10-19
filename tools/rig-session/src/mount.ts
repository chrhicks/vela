import { attributesOf, elementsOf } from './indi.ts'
import type { MountSample } from './inputs.ts'
import type { RecordedDevice, RecordedLine } from './recording.ts'
import { localSiderealHours } from './replay/sidereal.ts'

type Mutable<Item> = { -readonly [Key in keyof Item]: Item[Key] }

interface MountState {
  raHours: number | null
  decDegrees: number | null
  slewing: boolean | null
  tracking: boolean | null
  parked: boolean | null
  pierSide: 'east' | 'west' | null
  trackMode: string | null
  /** Read from the site property, used for sidereal time and never exported. */
  eastLongitudeDegrees: number | null
}

const on = (elements: Readonly<Record<string, string>>) => Object.entries(elements).find(([, value]) => value === 'On')?.[0] ?? null

/**
 * The mount's readings over time, from the standard INDI telescope properties of the recording's
 * first mount: a sample whenever position, slewing (the position property is Busy), tracking, park,
 * pier side or track mode changes. Cria's mount has no `TIME_LST`, so sidereal time comes from the
 * recorded longitude and the time of the message; without a longitude it is null. A sample is valid until the connection closes, a gap or the end. Two changes in one
 * millisecond make one sample, the later one, because sample times are unique.
 */
export function mountSamplesOf(lines: readonly RecordedLine[], devices: readonly RecordedDevice[]): MountSample[] {
  const indiDevice = devices.find(device => device.kind === 'mount')?.indiDevice

  const state: MountState = { raHours: null, decDegrees: null, slewing: null, tracking: null, parked: null, pierSide: null, trackMode: null, eastLongitudeDegrees: null }
  const samples: Mutable<MountSample>[] = []

  let open = 0

  for (const line of lines) {
    if (line.k === 'gap' || line.k === 'end' || (line.k === 'conn' && line.status === 'closed')) {
      for (const sample of samples.slice(open)) sample.validUntil = line.at

      open = samples.length
    }

    if (line.k !== 'msg' || line.dir !== 'in') continue

    const root = /^\s*<(def|set)\w+Vector\b([^>]*?)>/.exec(line.xml)
    const { device, name, state: propertyState } = attributesOf(root?.[2] ?? '')

    if (root === null || device !== indiDevice || name === undefined) continue

    const before = JSON.stringify({ ...state, eastLongitudeDegrees: null })
    const elements = elementsOf(line.xml)

    if (name === 'EQUATORIAL_EOD_COORD') {
      state.raHours = elements.RA === undefined ? state.raHours : Number(elements.RA)
      state.decDegrees = elements.DEC === undefined ? state.decDegrees : Number(elements.DEC)
      state.slewing = propertyState === 'Busy'
    } else if (name === 'TELESCOPE_TRACK_STATE') state.tracking = on(elements) === 'TRACK_ON'
    else if (name === 'TELESCOPE_PARK') state.parked = on(elements) === 'PARK'
    else if (name === 'TELESCOPE_PIER_SIDE') state.pierSide = { PIER_EAST: 'east' as const, PIER_WEST: 'west' as const }[on(elements) ?? ''] ?? null
    else if (name === 'TELESCOPE_TRACK_MODE') state.trackMode = on(elements)?.replace(/^TRACK_/, '').toLowerCase() ?? null
    else if (name === 'GEOGRAPHIC_COORD' && elements.LONG !== undefined) state.eastLongitudeDegrees = Number(elements.LONG)

    if (JSON.stringify({ ...state, eastLongitudeDegrees: null }) === before || state.raHours === null || state.decDegrees === null) continue

    const sample: MountSample = {
      source: 'indi',
      sampledAt: line.at,
      validUntil: null,
      raHours: state.raHours,
      decDegrees: state.decDegrees,
      lstHours: state.eastLongitudeDegrees === null ? null : localSiderealHours(line.at.getTime(), state.eastLongitudeDegrees),
      tracking: state.tracking,
      slewing: state.slewing,
      parked: state.parked,
      pierSide: state.pierSide,
      trackMode: state.trackMode,
    }

    if (samples.at(-1)?.sampledAt.getTime() === line.at.getTime()) {
      samples.pop()
      open = Math.min(open, samples.length)
    }

    samples.push(sample)
  }

  return samples
}
