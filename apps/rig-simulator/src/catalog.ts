import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Star {
  raDegrees: number
  decDegrees: number
  magnitude: number
}

export interface StarField {
  raDegrees: number
  decDegrees: number
  radiusDegrees: number
}

export type StarSource = (field: StarField, signal?: AbortSignal) => Promise<readonly Star[]>

const radians = Math.PI / 180

function angularDistance(a: Pick<Star, 'raDegrees' | 'decDegrees'>, b: Pick<Star, 'raDegrees' | 'decDegrees'>) {
  const decA = a.decDegrees * radians
  const decB = b.decDegrees * radians

  const haversine = Math.sin((decB - decA) / 2) ** 2
    + Math.cos(decA) * Math.cos(decB) * Math.sin((b.raDegrees - a.raDegrees) * radians / 2) ** 2

  return 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine)))) / radians
}

// Retain one padded field, not an all-sky object graph. Each cache miss owns its
// reads, so cancelling one camera cannot cancel another camera's acquisition.
export function createStarSource(directory: string): StarSource {
  let cached: { field: StarField, stars: readonly Star[] } | undefined

  return async (requested, signal) => {
    const field = { ...requested }

    if (![field.raDegrees, field.decDegrees, field.radiusDegrees].every(Number.isFinite)
        || field.raDegrees < 0 || field.raDegrees >= 360
        || Math.abs(field.decDegrees) > 90 || field.radiusDegrees <= 0 || field.radiusDegrees > 180) {
      throw new Error('Catalog field requires RA within 0–360°, declination within -90–90°, and radius within 0–180°')
    }

    signal?.throwIfAborted()

    if (cached && angularDistance(field, cached.field) + field.radiusDegrees <= cached.field.radiusDegrees) {
      return cached.stars.filter(star => angularDistance(field, star) <= field.radiusDegrees)
    }

    const padded = { ...field, radiusDegrees: Math.min(180, field.radiusDegrees + 1) }
    const names = (await readdir(directory)).filter(name => /^d05_\d+\.1476$/i.test(name)).sort()
    signal?.throwIfAborted()

    if (names.length === 0) throw new Error(`No ASTAP D05 .1476 tiles found in ${directory}`)
    const stars: Star[] = []

    for (const name of names) {
      signal?.throwIfAborted()
      // Decode one tile at a time and discard stars outside this field.
      const tile = decodeD05(await readFile(join(directory, name), { signal }), name)

      for (const star of tile) {
        if (Math.abs(star.decDegrees - padded.decDegrees) <= padded.radiusDegrees
            && angularDistance(padded, star) <= padded.radiusDegrees) stars.push(star)
      }
    }

    signal?.throwIfAborted()

    if (stars.length === 0) throw new Error('D05 catalog contains no stars around the requested simulator field')
    cached = { field: padded, stars }

    return stars.filter(star => angularDistance(field, star) <= field.radiusDegrees)
  }
}

export interface CatalogBounds {
  minRaDegrees: number
  maxRaDegrees: number
  minDecDegrees: number
  maxDecDegrees: number
}

export const defaultCatalogBounds: CatalogBounds = {
  minRaDegrees: 0,
  maxRaDegrees: 70,
  minDecDegrees: 50,
  maxDecDegrees: 70,
}

// ASTAP D05 binary format: 110-byte header followed by five-byte records.
// A 0xffffff RA marks a block's signed declination high byte and BP magnitude.
// This is an independent format reader; catalog data remains external to Vela.
export function decodeD05(data: Uint8Array, source = 'D05 tile'): Star[] {
  if (data.length < 110 || data[109] !== 5 || (data.length - 110) % 5 !== 0) {
    throw new Error(`${source}: unsupported or truncated D05 tile (expected five-byte records)`)
  }

  const stars: Star[] = []
  let decHigh: number | undefined
  let magnitude = 0

  for (let offset = 110; offset < data.length; offset += 5) {
    const raRaw = data[offset]! + data[offset + 1]! * 256 + data[offset + 2]! * 65536
    const low = data[offset + 3]!
    const high = data[offset + 4]!

    if (raRaw === 0xffffff) {
      decHigh = low - 128
      magnitude = (high - 16) / 10
      continue
    }

    if (decHigh === undefined) throw new Error(`${source}: star before D05 block header`)
    const raDegrees = raRaw * 360 / 0xffffff
    const decDegrees = (decHigh * 65536 + high * 256 + low) * 90 / 0x7fffff

    if (Math.abs(decDegrees) > 90) throw new Error(`${source}: declination outside -90 to 90 degrees`)
    stars.push({ raDegrees, decDegrees, magnitude })
  }

  return stars
}

export async function loadCatalog(directory: string, bounds: CatalogBounds = defaultCatalogBounds): Promise<Star[]> {
  const { minRaDegrees, maxRaDegrees, minDecDegrees, maxDecDegrees } = bounds

  if (![minRaDegrees, maxRaDegrees, minDecDegrees, maxDecDegrees].every(Number.isFinite)
      || minRaDegrees < 0 || maxRaDegrees > 360 || minRaDegrees >= maxRaDegrees
      || minDecDegrees < -90 || maxDecDegrees > 90 || minDecDegrees >= maxDecDegrees) {
    throw new Error('Catalog bounds must be ordered RA within 0–360° and declination within -90–90°')
  }

  const names = (await readdir(directory)).filter(name => /^d05_\d+\.1476$/i.test(name)).sort()

  if (names.length === 0) throw new Error(`No ASTAP D05 .1476 tiles found in ${directory}`)
  const stars: Star[] = []

  for (const name of names) {
    const tile = decodeD05(await readFile(join(directory, name)), name)

    for (const star of tile) {
      if (star.raDegrees >= minRaDegrees && star.raDegrees <= maxRaDegrees
          && star.decDegrees >= minDecDegrees && star.decDegrees <= maxDecDegrees) stars.push(star)
    }
  }

  if (stars.length === 0) throw new Error('D05 catalog contains no stars inside the simulator sky bounds')

  return stars
}
