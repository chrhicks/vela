/**
 * The scrub guard: finds what must not be committed in a fixture of this public repository. It looks
 * for a real observing site, in any of the shapes a site takes in a file Vela or Cria reads or writes,
 * and for a serial-number path that names real hardware. A finding names the file, the line and the rule,
 * never the value, so a failing run does not print the coordinates it found.
 */

export type Rule =
  | 'serial-by-id'
  | 'indi-site'
  | 'site-coordinate'
  | 'fits-location-card'
  | 'implied-site-longitude'

export interface Finding {
  path: string
  /** 1-based; for a FITS header, the number of the 80-byte card. */
  line: number
  rule: Rule
}

/** Sites that are made up. Longitudes are east positive. */
export const fakeSites = [
  { latitude: 40, longitude: -75 },
  { latitude: 10, longitude: 20 },
]

/** Serial paths whose serial numbers were replaced by placeholders before they were committed. */
const placeholderSerialPaths = [
  '/dev/serial/by-id/usb-ZWO_Systems_ZWO_Device_123456-if00',
  '/dev/serial/by-id/usb-Pegasus_Astro_PPBMicro_revB_PPBMA00000-if00-port0',
]

const fitsLocationKeys = ['SITELAT', 'SITELONG', 'SITEELEV', 'LAT-OBS', 'LONG-OBS', 'ALT-OBS', 'OBSGEO-L', 'OBSGEO-B', 'OBSGEO-H', 'OBSGEO-X', 'OBSGEO-Y', 'OBSGEO-Z', 'OBJCTRA', 'OBJCTDEC']

const number = '(-?\\d+(?:\\.\\d+)?)'

const isFakeLatitude = (value: number) => fakeSites.some(site => site.latitude === value)

const longitudeGap = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

const isFakeLongitude = (value: number) => fakeSites.some(site => longitudeGap(site.longitude, value) < 1e-9)

// A longitude derived from logged sidereal time carries the log's rounding and the sidereal formula's error.
const isNearFakeLongitude = (value: number) => fakeSites.some(site => longitudeGap(site.longitude, value) < 0.1)

/**
 * The text lines whose coordinates are a site: INDI `GEOGRAPHIC_COORD` elements (a recording holds them
 * inside JSON strings, so the quotes may be escaped) and latitude/longitude fields.
 */
function siteCoordinateRules(line: string): Rule[] {
  const rules: Rule[] = []

  for (const match of line.matchAll(new RegExp(`name=\\\\?"(LAT|LONG)\\\\?"[^>]*>\\s*${number}|\\b(LAT|LONG)=${number}`, 'g'))) {
    const isLatitude = (match[1] ?? match[3]) === 'LAT'
    const value = Number(match[2] ?? match[4])

    if (!(isLatitude ? isFakeLatitude(value) : isFakeLongitude(value))) rules.push('indi-site')
  }

  for (const match of line.matchAll(new RegExp(`\\b(?:site[_ ]?)?(latitude|longitude)(?:Degrees|_deg)?["']?\\s*[:=]\\s*${number}`, 'gi'))) {
    const value = Number(match[2])

    if (!(match[1]!.toLowerCase() === 'latitude' ? isFakeLatitude(value) : isFakeLongitude(value))) rules.push('site-coordinate')
  }

  return rules
}

function serialRules(line: string): Rule[] {
  const paths = line.match(/\/dev\/serial\/by-id\/[^\s"'<>,;)]+/g) ?? []

  return paths.some(path => !placeholderSerialPaths.includes(path)) ? ['serial-by-id'] : []
}

function isFits(bytes: Buffer): boolean {
  return bytes.length >= 2880 && bytes.toString('latin1', 0, 9) === 'SIMPLE  ='
}

function fitsCardFindings(path: string, bytes: Buffer): Finding[] {
  const found: Finding[] = []

  for (let card = 0; card * 80 + 80 <= bytes.length; card++) {
    const key = bytes.toString('latin1', card * 80, card * 80 + 8).trim()

    if (key === 'END') break

    if (fitsLocationKeys.includes(key)) found.push({ path, line: card + 1, rule: 'fits-location-card' })
  }

  return found
}

/** Greenwich mean sidereal time in hours (IAU 1982) at `epochMs`. */
function greenwichSiderealHours(epochMs: number): number {
  const days = epochMs / 86_400_000 + 2440587.5 - 2451545.0

  return (((18.697374558 + 24.06570982441908 * days) % 24) + 24) % 24
}

/** A mount log with a UTC time and a local sidereal time next to each other states the longitude it was logged at. */
function impliedLongitudeFindings(path: string, text: string): Finding[] {
  const [header, ...rows] = text.split('\n')
  const columns = (header ?? '').split(',').map(name => name.trim().toLowerCase())
  const utc = columns.indexOf('utc')
  const lst = columns.indexOf('lst_h')

  if (utc < 0 || lst < 0) return []

  return rows.flatMap((row, index) => {
    const cells = row.split(',')
    const time = Date.parse(`${cells[utc] ?? ''}Z`)
    const sidereal = Number(cells[lst])

    if (Number.isNaN(time) || cells[lst] === '' || Number.isNaN(sidereal)) return []
    const longitude = ((((sidereal - greenwichSiderealHours(time)) * 15 + 540) % 360) + 360) % 360 - 180

    return isNearFakeLongitude(longitude) ? [] : [{ path, line: index + 2, rule: 'implied-site-longitude' as const }]
  }).slice(0, 1)
}

/** Findings for one file, from its bytes. Findings of one rule on one line are reported once. */
export function scrubFile(path: string, bytes: Buffer): Finding[] {
  const found: Finding[] = isFits(bytes) ? fitsCardFindings(path, bytes) : []
  const text = bytes.toString('latin1')

  text.split('\n').forEach((line, index) => {
    for (const rule of new Set([...serialRules(line), ...siteCoordinateRules(line)])) found.push({ path, line: index + 1, rule })

    for (const key of fitsLocationKeys) {
      if (new RegExp(`(?<![A-Z-])${key}\\s*=`).test(line) && !isFits(bytes)) found.push({ path, line: index + 1, rule: 'fits-location-card' })
    }
  })

  if (path.endsWith('.csv')) found.push(...impliedLongitudeFindings(path, text))

  return found
}
