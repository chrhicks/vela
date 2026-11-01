export interface Hit {
  readonly file: string
  readonly line: number
  readonly entry: number
}

export function parseForbidden(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

const numeric = /^-?[\d.]+$/

const digit = /\d/

/**
 * A short number turns up inside longer numbers (a catalogue entry, a hash), so a numeric value
 * does not count when digits touch it on both sides. A digit on one side only still counts: that
 * is the same value written with more precision.
 */
function holds(line: string, value: string): boolean {
  for (let at = line.indexOf(value); at !== -1; at = line.indexOf(value, at + 1)) {
    const inside = digit.test(line[at - 1] ?? '') && digit.test(line[at + value.length] ?? '')

    if (!numeric.test(value) || !inside) return true
  }

  return false
}

/** Reports where a forbidden value sits, never the value: the report itself must be safe to log and commit. */
export function scanText(file: string, text: string, forbidden: readonly string[]): Hit[] {
  const hits: Hit[] = []
  const lines = text.split('\n')

  for (let index = 0; index < lines.length; index++)
    for (let entry = 0; entry < forbidden.length; entry++)
      if (holds(lines[index] ?? '', forbidden[entry] ?? '\0')) hits.push({ file, line: index + 1, entry: entry + 1 })

  return hits
}

export function isBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0)
}

export function formatHit(hit: Hit): string {
  return `${hit.file}:${hit.line} holds forbidden value #${hit.entry}`
}
