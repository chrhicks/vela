import type { PlateSolution } from '../frames/stats.ts'

const radians = Math.PI / 180

export interface Sky {
  readonly raDegrees: number
  readonly decDegrees: number
}

export interface Pixel {
  readonly x: number
  readonly y: number
}

export function toSky({ centre, referencePixel: [x0, y0], matrix: [[a, b], [c, d]] }: PlateSolution, { x, y }: Pixel): Sky {
  const xi = (a * (x - x0) + b * (y - y0)) * radians
  const eta = (c * (x - x0) + d * (y - y0)) * radians
  const ra0 = centre.raDegrees * radians
  const dec0 = centre.decDegrees * radians
  const across = Math.cos(dec0) - eta * Math.sin(dec0)
  const ra = ra0 + Math.atan2(xi, across)
  const dec = Math.atan2(Math.sin(dec0) + eta * Math.cos(dec0), Math.hypot(xi, across))

  return { raDegrees: (((ra / radians) % 360) + 360) % 360, decDegrees: dec / radians }
}

export function toPixel({ centre, referencePixel: [x0, y0], matrix: [[a, b], [c, d]] }: PlateSolution, sky: Sky): Pixel | undefined {
  const ra0 = centre.raDegrees * radians
  const dec0 = centre.decDegrees * radians
  const dec = sky.decDegrees * radians
  const turned = sky.raDegrees * radians - ra0
  const facing = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * Math.cos(dec) * Math.cos(turned)

  if (facing <= 0) return undefined

  const xi = (Math.cos(dec) * Math.sin(turned)) / facing / radians
  const eta = (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * Math.cos(dec) * Math.cos(turned)) / facing / radians
  const determinant = a * d - b * c

  return { x: x0 + (d * xi - b * eta) / determinant, y: y0 + (a * eta - c * xi) / determinant }
}
