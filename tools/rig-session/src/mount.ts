import { attributesOf, elementsOf } from './wire.ts'
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

const emptyState = (): MountState => ({ raHours: null, decDegrees: null, slewing: null, tracking: null, parked: null, pierSide: null, trackMode: null, eastLongitudeDegrees: null })

/**
 * The mount's readings over time, from the standard INDI telescope properties of the recording's
 * first mount: a sample whenever position, slewing (the position property is Busy), tracking, park,
 * pier side or track mode changes. Cria's mount has no `TIME_LST`, so sidereal time comes from the
 * recorded longitude and the time of the message; without a longitude it is null. Two changes in one
 * millisecond make one sample, the later one, because sample times are unique.
 *
 * The driver reports only changes, so a sample holds until the evidence is lost, and then it stops
 * (`validUntil`) and what was accumulated is forgotten: a later message starts from nothing and a sample
 * never carries a field from before the loss. Evidence is lost when a connection that carried the mount
 * closes, at a gap or the end, when the mount's `CONNECTION` turns off, when its properties are
 * deleted, and at the last line read of a recording that did not end cleanly (damage, a torn tail, a
 * recording still being written): `finish` is told where.
 */
export class MountTracker {
  readonly #indiDevice: string | undefined
  readonly #samples: Mutable<MountSample>[] = []
  readonly #connections = new Set<number>()
  #state = emptyState()
  #open = 0

  constructor(devices: readonly RecordedDevice[]) {
    this.#indiDevice = devices.find(device => device.kind === 'mount')?.indiDevice
  }

  accept(line: RecordedLine): void {
    if (line.k === 'gap' || line.k === 'end') this.#lose(line.at)
    else if (line.k === 'conn' && line.status === 'closed' && this.#connections.delete(line.conn) && this.#connections.size === 0) this.#lose(line.at)
    else if (line.k === 'msg' && line.dir === 'in') this.#message(line)
  }

  /** The samples. `evidenceEndsAt` is the last line read when the recording did not end cleanly, else null. */
  finish(evidenceEndsAt: Date | null): MountSample[] {
    if (evidenceEndsAt !== null) this.#lose(evidenceEndsAt)

    return this.#samples
  }

  /** The samples held so far stop being in force at `at`, and nothing accumulated is kept. */
  #lose(at: Date): void {
    for (const sample of this.#samples.slice(this.#open)) sample.validUntil = at

    this.#open = this.#samples.length
    this.#state = emptyState()
    this.#connections.clear()
  }

  #message(line: Extract<RecordedLine, { k: 'msg' }>): void {
    const deleted = /^\s*<delProperty\b([^>]*?)\/?>/.exec(line.xml)

    if (deleted !== null) {
      if (attributesOf(deleted[1] ?? '').device === this.#indiDevice) this.#lose(line.at)

      return
    }

    const root = /^\s*<(def|set)\w+Vector\b([^>]*?)>/.exec(line.xml)
    const { device, name, state: propertyState } = attributesOf(root?.[2] ?? '')

    if (root === null || device !== this.#indiDevice || name === undefined) return

    this.#connections.add(line.conn)

    const state = this.#state
    const before = JSON.stringify({ ...state, eastLongitudeDegrees: null })
    const elements = elementsOf(line.xml)

    if (name === 'CONNECTION' && on(elements) === 'DISCONNECT') {
      this.#lose(line.at)

      return
    }

    if (name === 'EQUATORIAL_EOD_COORD') {
      state.raHours = elements.RA === undefined ? state.raHours : Number(elements.RA)
      state.decDegrees = elements.DEC === undefined ? state.decDegrees : Number(elements.DEC)
      state.slewing = propertyState === 'Busy'
    } else if (name === 'TELESCOPE_TRACK_STATE') state.tracking = on(elements) === 'TRACK_ON'
    else if (name === 'TELESCOPE_PARK') state.parked = on(elements) === 'PARK'
    else if (name === 'TELESCOPE_PIER_SIDE') state.pierSide = { PIER_EAST: 'east' as const, PIER_WEST: 'west' as const }[on(elements) ?? ''] ?? null
    else if (name === 'TELESCOPE_TRACK_MODE') state.trackMode = on(elements)?.replace(/^TRACK_/, '').toLowerCase() ?? null
    else if (name === 'GEOGRAPHIC_COORD' && elements.LONG !== undefined) state.eastLongitudeDegrees = Number(elements.LONG)

    if (JSON.stringify({ ...state, eastLongitudeDegrees: null }) === before || state.raHours === null || state.decDegrees === null) return

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

    if (this.#samples.at(-1)?.sampledAt.getTime() === line.at.getTime()) {
      this.#samples.pop()
      this.#open = Math.min(this.#open, this.#samples.length)
    }

    this.#samples.push(sample)
  }
}

/** The samples of a run of lines. `evidenceEndsAt` is where the evidence stops if the run did not end cleanly. */
export function mountSamplesOf(lines: readonly RecordedLine[], devices: readonly RecordedDevice[], evidenceEndsAt: Date | null = null): MountSample[] {
  const tracker = new MountTracker(devices)

  for (const line of lines) tracker.accept(line)

  return tracker.finish(evidenceEndsAt)
}
