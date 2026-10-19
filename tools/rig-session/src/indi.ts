import type { RecordedLine } from './recording.ts'
import { isPrivateProperty, redacted, redactText } from './redact.ts'

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
  /** Element to value as the message sent them; a BLOB element holds its size in bytes. */
  readonly values: Readonly<Record<string, string>> | null
  /** The elements of `values` that differ from what the property held before. */
  readonly changed: Readonly<Record<string, string>> | null
  readonly text: string | null
}

interface Property {
  state: string | null
  values: Record<string, string>
}

const entities = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
])

const decode = (text: string) => text.replaceAll(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities.get(name) ?? '')

const attributesOf = (text: string) => Object.fromEntries([...text.matchAll(/([\w.:-]+)="([^"]*)"/g)].map(([, name = '', value = '']) => [name, decode(value)]))

/** The elements of one INDI vector: `<oneNumber name="RA">1.5</oneNumber>` and the like. */
function elementsOf(xml: string) {
  const elements: Record<string, string> = {}

  for (const [, tag = '', attributes = '', body = ''] of xml.matchAll(/<((?:one|def)(?:Number|Text|Switch|Light|BLOB))\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
    const { name, size } = attributesOf(attributes)

    if (name !== undefined) elements[name] = tag.endsWith('BLOB') ? (size ?? '') : decode(body.trim())
  }

  return elements
}

/**
 * The changes on the wire, in order. A definition is an event the first time a property is defined
 * on a connection; an update is a `set` that changes the state or a value, or a definition that does;
 * Cria repeats definitions on every `getProperties`, and a `set` that restates the same values is not an
 * event, except a BLOB, because an image of the same size is still an image. The values of the site and
 * of the ports are compared but never exported.
 */
export function indiEvents(lines: readonly RecordedLine[]): IndiEvent[] {
  const properties = new Map<string, Property>()
  const events: IndiEvent[] = []

  for (const line of lines) {
    if (line.k !== 'msg') continue

    const root = /^\s*<(\w+)\b([^>]*?)\/?>/.exec(line.xml)
    const tag = root?.[1] ?? ''
    const attributes = attributesOf(root?.[2] ?? '')
    const { device = null, name = null } = attributes
    const base = { at: line.at, conn: line.conn, direction: line.dir, n: line.n, device, property: name, state: attributes.state ?? null }
    const hidden = (values: Readonly<Record<string, string>>) => (name !== null && isPrivateProperty(name) ? { '*': redacted } : values)
    const key = `${line.conn}/${device}/${name}`

    if (tag === 'message') events.push({ ...base, kind: 'message', values: null, changed: null, text: redactText(attributes.message ?? '') })
    else if (tag === 'delProperty') {
      properties.delete(key)
      events.push({ ...base, kind: 'delete', values: null, changed: null, text: null })
    } else if (line.dir === 'out' && tag.startsWith('new')) events.push({ ...base, kind: 'write', values: hidden(elementsOf(line.xml)), changed: null, text: null })
    else if (line.dir === 'in' && (tag.startsWith('def') || tag.startsWith('set')) && tag.endsWith('Vector')) {
      const values = elementsOf(line.xml)
      const before = properties.get(key)
      const changed = Object.fromEntries(Object.entries(values).filter(([element, value]) => before?.values[element] !== value))
      const state = base.state ?? before?.state ?? null

      properties.set(key, { state, values: { ...before?.values, ...values } })

      if (before === undefined) events.push({ ...base, kind: tag.startsWith('def') ? 'define' : 'update', state, values: hidden(values), changed: tag.startsWith('def') ? null : hidden(changed), text: null })
      else if (state !== before.state || Object.keys(changed).length > 0 || tag.endsWith('BLOBVector')) events.push({ ...base, kind: 'update', state, values: hidden(values), changed: hidden(changed), text: null })
    }
  }

  return events
}
