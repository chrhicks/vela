export interface SkyCut {
  readonly raDegrees: number
  readonly decDegrees: number
  readonly widthDegrees: number
  readonly widthPixels: number
  readonly heightPixels: number
  readonly order: number
  readonly tileWidth: number
}

export interface CutPlan {
  readonly tiles: Int32Array
  readonly columns: Uint16Array
  readonly rows: Uint16Array
}

const radians = Math.PI / 180
const quarterTurn = Math.PI / 2
const equatorialBelt = 2 / 3

interface FacePixel {
  readonly face: number
  readonly x: number
  readonly y: number
}

function facePixel(ra: number, dec: number, sidePixels: number, sideBits: number): FacePixel {
  const z = Math.sin(dec)
  const turns = (((ra / quarterTurn) % 4) + 4) % 4

  if (Math.abs(z) <= equatorialBelt) {
    const along = sidePixels * (0.5 + turns)
    const up = sidePixels * z * 0.75
    const plus = Math.floor(along - up)
    const minus = Math.floor(along + up)
    const plusFace = plus >> sideBits
    const minusFace = minus >> sideBits

    return {
      face: plusFace === minusFace ? plusFace | 4 : plusFace < minusFace ? plusFace : minusFace + 8,
      x: minus & (sidePixels - 1),
      y: sidePixels - (plus & (sidePixels - 1)) - 1,
    }
  }

  const quarter = Math.min(3, Math.floor(turns))
  const within = turns - quarter
  const reach = sidePixels * Math.sqrt(3 * (1 - Math.abs(z)))
  const plus = Math.min(sidePixels - 1, Math.floor(within * reach))
  const minus = Math.min(sidePixels - 1, Math.floor((1 - within) * reach))

  return z >= 0 ? { face: quarter, x: sidePixels - minus - 1, y: sidePixels - plus - 1 } : { face: quarter + 8, x: plus, y: minus }
}

function interleaved(x: number, y: number, bits: number) {
  let woven = 0

  for (let bit = 0; bit < bits; bit += 1) woven |= (((x >> bit) & 1) << (2 * bit)) | (((y >> bit) & 1) << (2 * bit + 1))

  return woven
}

export function cutPlan(cut: SkyCut): CutPlan {
  const pixels = cut.widthPixels * cut.heightPixels
  const tiles = new Int32Array(pixels)
  const columns = new Uint16Array(pixels)
  const rows = new Uint16Array(pixels)
  const tileBits = Math.log2(cut.tileWidth)
  const sideBits = cut.order + tileBits
  const sidePixels = 1 << sideBits
  const tilesPerFace = 1 << (2 * cut.order)
  const scale = (cut.widthDegrees * radians) / cut.widthPixels
  const ra0 = cut.raDegrees * radians
  const sin0 = Math.sin(cut.decDegrees * radians)
  const cos0 = Math.cos(cut.decDegrees * radians)

  for (let row = 0; row < cut.heightPixels; row += 1) {
    const north = -(row + 0.5 - cut.heightPixels / 2) * scale
    const facing = cos0 - north * sin0

    for (let column = 0; column < cut.widthPixels; column += 1) {
      const east = -(column + 0.5 - cut.widthPixels / 2) * scale
      const ra = ra0 + Math.atan2(east, facing)
      const dec = Math.atan(((north * cos0 + sin0) * Math.cos(ra - ra0)) / facing)
      const { face, x, y } = facePixel(ra, dec, sidePixels, sideBits)
      const at = row * cut.widthPixels + column

      tiles[at] = face * tilesPerFace + interleaved(x >> tileBits, y >> tileBits, cut.order)
      columns[at] = y & (cut.tileWidth - 1)
      rows[at] = x & (cut.tileWidth - 1)
    }
  }

  return { tiles, columns, rows }
}

export const tilesOf = (plan: CutPlan): ReadonlyArray<number> => [...new Set(plan.tiles)].sort((a, b) => a - b)

export interface SkyPosition {
  readonly raDegrees: number
  readonly decDegrees: number
}

export function skyPositionAt(centre: SkyPosition, eastDegrees: number, northDegrees: number): SkyPosition {
  const ra0 = centre.raDegrees * radians
  const sin0 = Math.sin(centre.decDegrees * radians)
  const cos0 = Math.cos(centre.decDegrees * radians)
  const east = eastDegrees * radians
  const north = northDegrees * radians
  const facing = cos0 - north * sin0
  const ra = ra0 + Math.atan2(east, facing)
  const dec = Math.atan(((north * cos0 + sin0) * Math.cos(ra - ra0)) / facing)

  return { raDegrees: (((ra / radians) % 360) + 360) % 360, decDegrees: dec / radians }
}

export function tileAt(order: number, position: SkyPosition): number {
  const { face, x, y } = facePixel(position.raDegrees * radians, position.decDegrees * radians, 1 << order, order)

  return face * (1 << (2 * order)) + interleaved(x, y, order)
}

export const surveyPixelDegrees = (order: number, tileWidth: number) => Math.sqrt(Math.PI / 3) / (2 ** order * tileWidth) / radians
