export type PropertyState = 'Idle' | 'Ok' | 'Busy' | 'Alert'

export type Permission = 'ro' | 'wo' | 'rw'

export type Element =
  | { readonly kind: 'number'; readonly label: string; readonly value: number }
  | { readonly kind: 'switch'; readonly label: string; readonly on: boolean }
  | { readonly kind: 'text'; readonly label: string; readonly value: string }

export interface Vector {
  readonly device: string
  readonly name: string
  readonly kind: 'number' | 'switch' | 'text'
  readonly state: PropertyState | undefined
  readonly perm: Permission | undefined
  readonly elements: ReadonlyMap<string, Element>
}

export type Message =
  | { readonly type: 'def' | 'set'; readonly vector: Vector }
  | { readonly type: 'del'; readonly device: string; readonly name: string | undefined }

const entities = new Map([
  ['&quot;', '"'],
  ['&apos;', "'"],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&amp;', '&'],
])

const unescape = (text: string) => text.replace(/&(?:quot|apos|lt|gt|amp);/g, entity => entities.get(entity) ?? entity)

function attributesOf(text: string): Map<string, string> {
  const attributes = new Map<string, string>()

  for (const [, name, , value] of text.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/gs)) attributes.set(name!, unescape(value!))

  return attributes
}

/** INDI numbers are decimal or sexagesimal ("-12:30:15.5", "12 30 15"). */
function numberOf(text: string): number {
  const trimmed = text.trim()

  if (/^[-+]?\d+([:\s]\d+(\.\d*)?){1,2}$/.test(trimmed)) {
    const parts = trimmed.replace(/^[-+]/, '').split(/[:\s]+/).map(Number)
    const value = parts.reduce((total, part, index) => total + part / 60 ** index, 0)

    return trimmed.startsWith('-') ? -value : value
  }

  const value = Number(trimmed)

  if (trimmed === '' || !Number.isFinite(value)) throw new Error(`Invalid INDI number "${text}"`)

  return value
}

function stateOf(text: string | undefined): PropertyState | undefined {
  if (text === undefined) return undefined

  if (text === 'Idle' || text === 'Ok' || text === 'Busy' || text === 'Alert') return text

  throw new Error(`Unknown INDI state ${text}`)
}

function permissionOf(text: string | undefined): Permission | undefined {
  if (text === undefined) return undefined

  if (text === 'ro' || text === 'wo' || text === 'rw') return text

  throw new Error(`Unknown INDI permission ${text}`)
}

const kinds = new Map<string, Vector['kind']>([
  ['Number', 'number'],
  ['Switch', 'switch'],
  ['Text', 'text'],
])

function elementOf(kind: Vector['kind'], label: string, text: string): Element {
  switch (kind) {
    case 'number':
      return { kind, label, value: numberOf(text) }
    case 'switch':
      return { kind, label, on: text.trim() === 'On' }
    case 'text':
      return { kind, label, value: unescape(text.trim()) }
  }
}

function vectorFrom(xml: string, word: string, headText: string): Vector | undefined {
  const kind = kinds.get(word)
  const attributes = attributesOf(headText)
  const device = attributes.get('device')
  const name = attributes.get('name')

  if (kind === undefined || device === undefined || name === undefined) return undefined

  const elements = new Map<string, Element>()
  const child = new RegExp(`<(?:def|one)${word}\\b([^>]*)>([\\s\\S]*?)</(?:def|one)${word}>`, 'g')

  for (const [, childHead, content] of xml.matchAll(child)) {
    const found = attributesOf(childHead!)
    const elementName = found.get('name')

    if (elementName !== undefined) elements.set(elementName, elementOf(kind, found.get('label') ?? elementName, content!))
  }

  return { device, name, kind, state: stateOf(attributes.get('state')), perm: permissionOf(attributes.get('perm')), elements }
}

/**
 * Reads one recorded INDI element. Numbers, switches and texts become a `Vector`; lights, BLOBs, `getProperties`
 * and `new*` requests (which indiserver relays from other clients) are not mount readings and give `undefined`.
 * Throws on a number, state or permission INDI does not allow.
 */
export function parseMessage(xml: string): Message | undefined {
  const deleted = /^\s*<delProperty\b([^>]*)>/.exec(xml)

  if (deleted) {
    const attributes = attributesOf(deleted[1]!)
    const device = attributes.get('device')

    return device === undefined ? undefined : { type: 'del', device, name: attributes.get('name') }
  }

  const head = /^\s*<(def|set)(Number|Switch|Text)Vector\b([^>]*)>/.exec(xml)

  if (!head) return undefined

  const vector = vectorFrom(xml, head[2]!, head[3]!)

  return vector === undefined ? undefined : { type: head[1] === 'def' ? 'def' : 'set', vector }
}

/** Reads one `newNumberVector`, `newSwitchVector` or `newTextVector`, the command a client sends. Anything else gives `undefined`. */
export function parseRequest(xml: string): Vector | undefined {
  const head = /^\s*<new(Number|Switch|Text)Vector\b([^>]*)>/.exec(xml)

  return head ? vectorFrom(xml, head[1]!, head[2]!) : undefined
}
