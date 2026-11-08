export type Value = number | boolean | string

export interface Entry {
  readonly id: string
  readonly kind: string
  readonly at: number
  readonly run: string | undefined
  readonly body: unknown
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

export function recordOf(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined
}

export function readEntry(text: string): Entry | undefined {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }

  const entry = recordOf(parsed)

  if (entry === undefined || typeof entry['kind'] !== 'string' || typeof entry['at'] !== 'number') return undefined

  return {
    id: typeof entry['id'] === 'string' ? entry['id'] : '',
    kind: entry['kind'],
    at: entry['at'],
    run: typeof entry['run'] === 'string' ? entry['run'] : undefined,
    body: entry['body'],
  }
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
