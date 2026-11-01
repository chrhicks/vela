// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Canonical JSON is defined over any JSON value.
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Separates scalars from containers in a JSON value.
  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}

const offset = 0xcbf29ce484222325n

const prime = 0x100000001b3n

const mask = 0xffffffffffffffffn

export function fnv1a64(text: string): string {
  let hash = offset

  for (const byte of new TextEncoder().encode(text)) hash = ((hash ^ BigInt(byte)) * prime) & mask

  return hash.toString(16).padStart(16, '0')
}
