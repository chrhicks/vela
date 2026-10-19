import { z } from 'zod'
import { jsonText } from './inputs.ts'
import type { AnyColumn } from './schema.ts'

/**
 * What a package never holds: the observing site, serial port paths, device serial numbers, host
 * addresses and credentials. A package is shared in conversation, so every string that reaches a
 * Parquet cell or `session.json` passes through here, once, at the point the rows are written
 * (`package.ts`). No table lists its own private columns, so a new column, table or INDI property
 * cannot leak by being forgotten.
 *
 * Two layers. Learned values: while it reads its inputs the packager learns the secrets from the data
 * itself (the recording's own site, ports and serial numbers, the journal's origin), and `Secrets`
 * replaces them wherever they occur, in any common formatting. Patterns: things that look private
 * whatever their source. A third check, `leaks`, runs over the finished tables and fails the build.
 */
export const redacted = '[redacted]'

const minimumLiteralLength = 4

/** Digits that carry information; fewer than this and a number occurs in unrelated text. */
const minimumSignificantDigits = 3

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

const significantDigits = (text: string) => text.replaceAll(/\D/g, '').replace(/^0+/, '').length

const decimalPlaces = (value: number) => /\.(\d+)/.exec(String(value))?.[1]?.length ?? 0

export type Coordinate = 'latitude' | 'longitude' | 'elevation'

/**
 * The decimal spellings of `value` that a log or a driver message uses: rounded and truncated to every
 * precision, unsigned, and for a longitude also wrapped into 0 to 360 and into -180 to 180.
 */
function decimalForms(value: number, kind: Coordinate): string[] {
  const magnitudes = new Set([Math.abs(value)])

  if (kind === 'longitude') {
    magnitudes.add((((value % 360) + 360) % 360))
    magnitudes.add(Math.abs(value > 180 ? value - 360 : value))
  }

  const forms = new Set<string>()
  const longest = Math.min(12, Math.max(decimalPlaces(value), 2) + 4)

  for (const magnitude of magnitudes) {
    for (let places = 1; places <= longest; places += 1) {
      const scale = 10 ** places

      for (const form of [magnitude.toFixed(places), (Math.trunc(magnitude * scale) / scale).toFixed(places)]) {
        if (significantDigits(form) >= minimumSignificantDigits) forms.add(form)
      }
    }
  }

  return [...forms].sort((a, b) => b.length - a.length)
}

/** Degrees, minutes and seconds with any of the usual marks or separators between them. */
function sexagesimalSources(value: number): string[] {
  const magnitude = Math.abs(value)
  const degrees = Math.floor(magnitude)
  const minutes = Math.floor((magnitude - degrees) * 60)
  const lead = `(?<![\\dT:.])[-+]?0?${degrees}`
  const middle = `0?${minutes}`

  return [
    `${lead}\\s*[°d:\\s]\\s*${middle}\\s*['′m:\\s]\\s*\\d{1,2}(?:\\.\\d+)?(?:\\s*(?:"|″|''|s))?(?!\\d)`,
    `${lead}\\s*[°d]\\s*${middle}\\s*['′m](?!\\d)`,
  ]
}

/** What this build has learned is private. Learned values are replaced wherever they occur. */
export class Secrets {
  readonly #literals = new Set<string>()
  readonly #coordinates: { readonly kind: Coordinate; readonly value: number }[] = []
  #compiled: { readonly literal: RegExp | null; readonly numbers: RegExp | null; readonly exact: RegExp | null } | null = null

  /** Text that is private as it stands: a port path, a serial number, a host. Too short to be distinctive is ignored. */
  addLiteral(text: string): void {
    const trimmed = text.trim()

    if (trimmed.length < minimumLiteralLength || this.#literals.has(trimmed)) return

    this.#literals.add(trimmed)
    this.#compiled = null
  }

  /** A site coordinate in degrees (east positive for a longitude) or an elevation in metres. */
  addCoordinate(kind: Coordinate, value: number): void {
    if (!Number.isFinite(value) || this.#coordinates.some(known => known.kind === kind && known.value === value)) return

    this.#coordinates.push({ kind, value })
    this.#compiled = null
  }

  /** `text` with every learned value replaced. */
  scrub(text: string): string {
    const { literal, numbers } = this.#compile()

    return text.replace(literal ?? never, redacted).replace(numbers ?? never, redacted)
  }

  /** Whether a JSON number is a learned coordinate at full precision. */
  isSecretNumber(value: number): boolean {
    return this.#compile().exact?.test(String(value)) ?? false
  }

  /** The kinds of learned value `text` still holds. The value is never returned. */
  find(text: string): string[] {
    const { literal, numbers } = this.#compile()

    return [...(literal?.test(text) ? ['learned value'] : []), ...(numbers?.test(text) ? ['learned coordinate'] : [])]
  }

  /** A host address as the journal or the manifest states it: the text, and the host and host:port inside it if it is a URL. Loopback is not a secret. */
  learnAddress(address: string): void {
    const text = address.trim()

    if (['localhost', '127.0.0.1', '::1'].includes(text)) return

    this.addLiteral(text)

    const url = URL.canParse(text) ? new URL(text) : null

    if (url !== null && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      this.addLiteral(url.hostname)
      this.addLiteral(url.host)
    }
  }

  /**
   * Learns the private values a JSON document holds under the keys that name them: a site coordinate under
   * `latitude`, `longitude` or `elevation`, a path, host or serial number under `port`, `origin`, `host` or `serial`.
   */
  learnFromJson(value: Json, key = ''): void {
    const asNumber = numberSchema.safeParse(value)

    if (asNumber.success) {
      const kind = coordinateKey(key)

      if (kind !== null) this.addCoordinate(kind, asNumber.data)

      return
    }

    const asText = textSchema.safeParse(value)

    if (asText.success) {
      if (literalKey.test(key)) this.addLiteral(asText.data)

      return
    }

    const asList = listSchema.safeParse(value)

    if (asList.success) {
      for (const item of asList.data) this.learnFromJson(item, key)

      return
    }

    const asRecord = recordSchema.safeParse(value)

    if (asRecord.success) {
      for (const [name, inner] of Object.entries(asRecord.data)) this.learnFromJson(inner, name)
    }
  }

  #compile() {
    if (this.#compiled !== null) return this.#compiled

    const literals = [...this.#literals].sort((a, b) => b.length - a.length).map(escape)

    const numbers = this.#coordinates.flatMap(({ kind, value }) => [
      ...decimalForms(value, kind).map(form => `(?<![\\d.])[-+]?${escape(form)}(?!\\d)`),
      ...(kind === 'elevation' ? [] : sexagesimalSources(value)),
    ])

    this.#compiled = {
      literal: literals.length === 0 ? null : new RegExp(literals.join('|'), 'g'),
      numbers: numbers.length === 0 ? null : new RegExp(numbers.join('|'), 'g'),
      exact: numbers.length === 0 ? null : new RegExp(`^(?:${numbers.join('|')})$`),
    }

    return this.#compiled
  }
}

/** Matches nothing: a replace that has no learned value to look for. */
const never = /(?!)/g

interface Pattern {
  readonly name: string
  readonly pattern: RegExp
  /** What replaces a match; it may keep part of it. */
  readonly replacement: (match: string, key?: string) => string
}

/** A text that names the site in words is replaced whole: its numbers come in too many shapes (degrees, sexagesimal, decimal) to find. */
const namesTheSite: Pattern = {
  name: 'site in words',
  pattern: /\b(?:latitude|longitude|observer location|geographic (?:coordinates?|location))\b/i,
  replacement: () => `${redacted} (names the site)`,
}

const alreadyRedacted = '(?!\\[redacted\\])'

/** Things that look private whatever their source. The names are what a failed build reports. */
const patterns: readonly Pattern[] = [
    { name: 'serial path', pattern: /(?<![\w./~-])\/dev\/[^\s"'<>,;)]+/g, replacement: () => redacted },
  { name: 'serial id', pattern: /\b(?:usb|pci|platform|ata|scsi)-[\w.:+-]*\d[\w.:+-]*/g, replacement: () => redacted },
  { name: 'site pair', pattern: new RegExp(`\\b(LAT|LONG|LON|LNG|ELEV)=${alreadyRedacted}\\S+`, 'gi'), replacement: (_, key = '') => `${key}=${redacted}` },
  { name: 'url credentials', pattern: new RegExp(`(?<=://)[^/\\s:@]+:[^@\\s/]*@${alreadyRedacted}`, 'g'), replacement: () => `${redacted}@` },
  { name: 'url token', pattern: new RegExp(`([?&](?:token|access_token|api_key|apikey|key|secret|password|passwd|auth|sig|signature)=)${alreadyRedacted}[^&\\s"']+`, 'gi'), replacement: (_, key = '') => `${key}${redacted}` },
  { name: 'bearer token', pattern: new RegExp(`\\bBearer\\s+${alreadyRedacted}[A-Za-z0-9._~+/-]{8,}=*`, 'g'), replacement: () => `Bearer ${redacted}` },
  { name: 'credential', pattern: /\b(?:eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}|(?:ghp|gho|ghs|github_pat|xox[abp]|sk|pk)_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16})\b/g, replacement: () => redacted },
]

/** JSON keys whose value is private whatever it looks like. */
const privateKey = /^(?:site|latitude|longitude|elevation|port|serial|lat|long|lon|lng|elev)/i

/** JSON keys whose string value is a path, host or serial number. */
const literalKey = /^(?:port|origin|host|hostname|serial)/i

function coordinateKey(key: string): Coordinate | null {
  if (/^(?:lat|latitude)/i.test(key)) return 'latitude'

  if (/^(?:long|lon|lng|longitude)/i.test(key)) return 'longitude'

  return /^(?:elev|elevation)/i.test(key) ? 'elevation' : null
}

/** `text` with learned values and private-looking patterns replaced. Replacing again changes nothing. */
export function sanitizeText(text: string, secrets: Secrets): string {
  if (namesTheSite.pattern.test(text)) return namesTheSite.replacement(text)

  return secrets.scrub(patterns.reduce((result, { pattern, replacement }) => result.replace(pattern, replacement), text))
}

/** Why `text` should not be in a package, by rule name; empty when it is clean. */
export function leaks(text: string, secrets: Secrets): string[] {
  return [...[namesTheSite, ...patterns].flatMap(({ name, pattern }) => (new RegExp(pattern.source, pattern.flags.replace('g', '')).test(text) ? [name] : [])), ...secrets.find(text)]
}

export type Json = z.infer<ReturnType<typeof z.json>>

/** The values a table cell holds. */
export type Cell = string | number | boolean | Date | null

const textSchema = z.string()

const numberSchema = z.number()

const listSchema = z.array(z.json())

const recordSchema = z.record(z.string(), z.json())

/** Every string in a JSON value, and every key, sanitised; the value of a private key replaced. */
export function sanitizeJson(value: Json, secrets: Secrets, key = ''): Json {
  if (key !== '' && privateKey.test(key)) return redacted

  const asText = textSchema.safeParse(value)

  if (asText.success) return sanitizeText(asText.data, secrets)

  const asNumber = numberSchema.safeParse(value)

  if (asNumber.success) return secrets.isSecretNumber(asNumber.data) ? redacted : value

  const asList = listSchema.safeParse(value)

  if (asList.success) return asList.data.map(item => sanitizeJson(item, secrets))

  const asRecord = recordSchema.safeParse(value)

  if (asRecord.success) {
    return Object.fromEntries(Object.entries(asRecord.data).map(([name, inner]) => [privateKey.test(name) ? name : sanitizeText(name, secrets), sanitizeJson(inner, secrets, name)]))
  }

  return value
}

/** A JSON column holds text. If it parses it is sanitised as a value, so a replacement cannot break its syntax. */
function sanitizeJsonText(cell: string, secrets: Secrets): string {
  const parsed = jsonText(z.json()).safeParse(cell)

  return parsed.success ? JSON.stringify(sanitizeJson(parsed.data, secrets)) : sanitizeText(cell, secrets)
}

/** Where a JSON value still leaks: its strings and its keys, except the names of private keys, whose values were replaced. */
function jsonLeaks(value: Json, secrets: Secrets, key = ''): string[] {
  if (key !== '' && privateKey.test(key)) return value === redacted ? [] : ['private key with a value']

  const asText = textSchema.safeParse(value)

  if (asText.success) return leaks(asText.data, secrets)

  const asNumber = numberSchema.safeParse(value)

  if (asNumber.success) return secrets.isSecretNumber(asNumber.data) ? ['learned coordinate'] : []

  const asList = listSchema.safeParse(value)

  if (asList.success) return asList.data.flatMap(item => jsonLeaks(item, secrets))

  const asRecord = recordSchema.safeParse(value)

  if (asRecord.success) {
    return Object.entries(asRecord.data).flatMap(([name, inner]) => [...(privateKey.test(name) ? [] : leaks(name, secrets)), ...jsonLeaks(inner, secrets, name)])
  }

  return []
}

/** The leaks in one string cell, read as JSON if its column is one. */
export function cellLeaks(cell: string, column: AnyColumn | undefined, secrets: Secrets): string[] {
  if (column?.kind !== 'json') return leaks(cell, secrets)

  const parsed = jsonText(z.json()).safeParse(cell)

  return parsed.success ? jsonLeaks(parsed.data, secrets) : leaks(cell, secrets)
}

/** One row with every text, link and JSON cell sanitised. The columns say what a cell is; none is exempt. */
export function sanitizeRow(row: Readonly<Record<string, Cell>>, columns: Readonly<Record<string, AnyColumn>>, secrets: Secrets): Record<string, Cell> {
  return Object.fromEntries(
    Object.entries(row).map(([name, cell]) => {
      const asText = textSchema.safeParse(cell)

      if (!asText.success) return [name, cell]

      return [name, columns[name]?.kind === 'json' ? sanitizeJsonText(asText.data, secrets) : sanitizeText(asText.data, secrets)]
    }),
  )
}
