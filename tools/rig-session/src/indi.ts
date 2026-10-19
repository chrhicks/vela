import type { RecordedLine } from './recording.ts'
import { attributesOf, elementsOf } from './wire.ts'

export type IndiEventKind = 'define' | 'update' | 'write' | 'message' | 'delete'

/** One thing that happened on the INDI wire, as the recorder saw it. */
export interface IndiEvent {
  readonly at: Date
  readonly conn: number
  readonly direction: 'in' | 'out'
  /** The message's ordinal on its connection and direction: with them it names the line in the recording. */
  readonly n: number
  readonly kind: IndiEventKind
  readonly device: string | null
  readonly property: string | null
  readonly state: string | null
  /** Element to value as the message sent them; a BLOB element holds its size in bytes. Null unless the property is in `exportedProperties`. */
  readonly values: Readonly<Record<string, string>> | null
  /** The elements of `values` that differ from what the property held before. */
  readonly changed: Readonly<Record<string, string>> | null
  readonly text: string | null
}

interface Property {
  state: string | null
  values: Record<string, string>
}

/**
 * The properties whose values are exported. A value is a free-form string from a driver, so the list is
 * of what is known to be safe and useful (position, tracking, exposure, temperature, binning, focus,
 * filter), never of what is known to be private: a property not named here still gives an event, with
 * no values, until someone adds it on purpose. The site, the ports, the clock and the serial numbers
 * are not named.
 */
export const exportedProperties: ReadonlySet<string> = new Set([
  'CONNECTION',
  'EQUATORIAL_EOD_COORD',
  'EQUATORIAL_COORD',
  'ON_COORD_SET',
  'TELESCOPE_ABORT_MOTION',
  'TELESCOPE_MOTION_NS',
  'TELESCOPE_MOTION_WE',
  'TELESCOPE_PARK',
  'TELESCOPE_PIER_SIDE',
  'TELESCOPE_SLEW_RATE',
  'TELESCOPE_TRACK_MODE',
  'TELESCOPE_TRACK_STATE',
  'CCD_ABORT_EXPOSURE',
  'CCD_BINNING',
  'CCD_CAPTURE_FORMAT',
  'CCD_CONTROLS',
  'CCD_COOLER',
  'CCD_COOLER_POWER',
  'CCD_EXPOSURE',
  'CCD_FRAME',
  'CCD_FRAME_TYPE',
  'CCD_GAIN',
  'CCD_OFFSET',
  'CCD_TEMPERATURE',
  'CCD_TRANSFER_FORMAT',
  'CCD1',
  'UPLOAD_MODE',
  'ABS_FOCUS_POSITION',
  'FOCUS_TEMPERATURE',
  'FILTER_SLOT',
  'FILTER_NAME',
])

/**
 * Reads the wire a line at a time and keeps the events. It remembers what each property held, so a
 * repeated definition or a `set` that restates the same values is not an event, and forgets it wherever
 * the evidence is lost: a closed connection or a gap, after which nothing is known of the properties, so
 * the next message reads as a first sight of the property. A definition is an event the first time a
 * property is defined on a connection; an update is a `set` that changes the state or a value, or a
 * definition that does; a BLOB is an event every time, because an image of the same size is still an image.
 */
export class IndiEventTracker {
  readonly events: IndiEvent[] = []
  readonly #properties = new Map<string, Property>()

  accept(line: RecordedLine): void {
    if (line.k === 'gap') this.#properties.clear()
    else if (line.k === 'conn' && line.status === 'closed') {
      for (const key of this.#properties.keys()) if (key.startsWith(`${line.conn}/`)) this.#properties.delete(key)
    } else if (line.k === 'msg') this.#message(line)
  }

  #message(line: Extract<RecordedLine, { k: 'msg' }>): void {
    const root = /^\s*<(\w+)\b([^>]*?)\/?>/.exec(line.xml)
    const tag = root?.[1] ?? ''
    const attributes = attributesOf(root?.[2] ?? '')
    const { device = null, name = null } = attributes
    const base = { at: line.at, conn: line.conn, direction: line.dir, n: line.n, device, property: name, state: attributes.state ?? null }
    const shown = (values: Readonly<Record<string, string>>) => (name !== null && exportedProperties.has(name) ? values : null)
    const key = `${line.conn}/${device}/${name}`

    if (tag === 'message') this.events.push({ ...base, kind: 'message', values: null, changed: null, text: attributes.message ?? '' })
    else if (tag === 'delProperty') {
      this.#properties.delete(key)
      this.events.push({ ...base, kind: 'delete', values: null, changed: null, text: null })
    } else if (line.dir === 'out' && tag.startsWith('new')) this.events.push({ ...base, kind: 'write', values: shown(elementsOf(line.xml)), changed: null, text: null })
    else if (line.dir === 'in' && (tag.startsWith('def') || tag.startsWith('set')) && tag.endsWith('Vector')) {
      const values = elementsOf(line.xml)
      const before = this.#properties.get(key)
      const changed = Object.fromEntries(Object.entries(values).filter(([element, value]) => before?.values[element] !== value))
      const state = base.state ?? before?.state ?? null

      this.#properties.set(key, { state, values: { ...before?.values, ...values } })

      if (before === undefined) this.events.push({ ...base, kind: tag.startsWith('def') ? 'define' : 'update', state, values: shown(values), changed: tag.startsWith('def') ? null : shown(changed), text: null })
      else if (state !== before.state || Object.keys(changed).length > 0 || tag.endsWith('BLOBVector')) this.events.push({ ...base, kind: 'update', state, values: shown(values), changed: shown(changed), text: null })
    }
  }
}

/** The events of a run of lines, in order. */
export function indiEvents(lines: readonly RecordedLine[]): IndiEvent[] {
  const tracker = new IndiEventTracker()

  for (const line of lines) tracker.accept(line)

  return tracker.events
}

/** One camera image the recording holds: an `in` BLOB message and the file it was saved to. */
export interface IndiImage {
  readonly at: Date
  readonly conn: number
  readonly n: number
  readonly device: string | null
  readonly property: string | null
  readonly element: string
  /** Relative to the recording folder. */
  readonly path: string
  /** The size INDI stated for the decoded file: a FITS, not Cria's ImageBytes. */
  readonly bytes: number | null
}

/** The images one line holds: the `in` BLOB elements that name a file the recorder saved. */
export function imagesOf(line: RecordedLine): IndiImage[] {
  if (line.k !== 'msg' || line.dir !== 'in') return []

  const { device = null, name = null } = attributesOf(/^\s*<\w+\b([^>]*?)>/.exec(line.xml)?.[1] ?? '')
  const images: IndiImage[] = []

  for (const [, attributes = ''] of line.xml.matchAll(/<oneBLOB\b([^>]*?)\/>/g)) {
    const { name: element = '', size = '', ref } = attributesOf(attributes)

    if (ref !== undefined && line.blobs?.includes(ref)) {
      images.push({ at: line.at, conn: line.conn, n: line.n, device, property: name, element, path: ref, bytes: /^\d+$/.test(size) ? Number(size) : null })
    }
  }

  return images
}

export function indiImages(lines: readonly RecordedLine[]): IndiImage[] {
  return lines.flatMap(imagesOf)
}
