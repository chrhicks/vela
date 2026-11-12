export type Value = number | boolean | string

export interface Entry {
  readonly seq: number
  readonly kind: string
  readonly at: number
  readonly body: unknown
}

export interface Message {
  readonly seq: number
  readonly subject: string
  readonly time: number
  readonly text: string
}

export interface WireBody {
  readonly dir: 'in' | 'out'
  readonly device: string
  readonly type: string
  readonly property: string | undefined
  readonly state: string | undefined
  readonly elements: Readonly<Record<string, Value>>
  readonly limits: Readonly<Record<string, Limits>>
}

export interface Limits {
  readonly min: number
  readonly max: number
}

type JsonRecord = Readonly<Record<string, unknown>>

const commandSubjectPrefix = 'rig-dev.command.'

export const commandSubject = (device: string) => `${commandSubjectPrefix}${device}`

export function recordOf(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

export function textOf(record: JsonRecord, name: string): string | undefined {
  const value = record[name]

  return typeof value === 'string' ? value : undefined
}

export function numberOf(record: JsonRecord, name: string): number | undefined {
  const value = record[name]

  return typeof value === 'number' ? value : undefined
}

function parseRecord(text: string): JsonRecord | undefined {
  try {
    return recordOf(JSON.parse(text))
  } catch {
    return undefined
  }
}

function commandDevice(subject: string): string | undefined {
  return subject.startsWith(commandSubjectPrefix) ? subject.slice(commandSubjectPrefix.length) : undefined
}

function readEntry(seq: number, text: string): Entry | undefined {
  const entry = parseRecord(text)
  const kind = entry === undefined ? undefined : textOf(entry, 'kind')
  const at = entry === undefined ? undefined : numberOf(entry, 'at')

  if (entry === undefined || kind === undefined || at === undefined) return undefined

  return { seq, kind, at, body: entry['body'] }
}

function readCommand(seq: number, device: string, at: number, text: string): Entry | undefined {
  const request = parseRecord(text)

  if (request === undefined) return undefined

  return { seq, kind: 'command', at, body: { ...request, device } }
}

export function readMessage({ seq, subject, time, text }: Message): Entry | undefined {
  const device = commandDevice(subject)

  if (device === undefined) return readEntry(seq, text)

  return readCommand(seq, device, time, text)
}

export function readWireBody(body: unknown): WireBody | undefined {
  const record = recordOf(body)

  if (record === undefined) return undefined

  const { dir, device, type, property, state, elements, numbers } = record

  if ((dir !== 'in' && dir !== 'out') || typeof device !== 'string' || typeof type !== 'string') return undefined

  const values: Record<string, Value> = {}

  for (const [name, value] of Object.entries(recordOf(elements) ?? {})) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') values[name] = value
  }

  const limits: Record<string, Limits> = {}

  for (const [name, number] of Object.entries(recordOf(numbers) ?? {})) {
    const range = recordOf(number)

    if (typeof range?.['min'] === 'number' && typeof range['max'] === 'number') limits[name] = { min: range['min'], max: range['max'] }
  }

  return { dir, device, type, property: typeof property === 'string' ? property : undefined, state: typeof state === 'string' ? state : undefined, elements: values, limits }
}
