import type { Star } from './catalog.js'
import type { CameraPose } from './mount.js'

interface RenderOptions {
  width: number
  height: number
  fieldHeightDegrees: number
  seed: number
  obscured?: boolean
}

export function renderSky(stars: readonly Star[], pose: CameraPose, options: RenderOptions): Uint16Array {
  const { width, height, fieldHeightDegrees } = options
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || width * height > 16777216 || !Number.isFinite(fieldHeightDegrees)
      || fieldHeightDegrees <= 0 || fieldHeightDegrees >= 180) {
    throw new Error('Invalid sky image dimensions or field height')
  }
  const intensity = new Float64Array(width * height)
  let randomState = options.seed >>> 0
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
    return randomState / 4294967296
  }
  for (let index = 0; index < intensity.length; index++) intensity[index] = 500 + (random() - 0.5) * 12

  const focalPixels = height / (2 * Math.tan(fieldHeightDegrees * Math.PI / 360))
  if (!options.obscured) {
    for (const star of stars) {
      const ra = star.raDegrees * Math.PI / 180
      const dec = star.decDegrees * Math.PI / 180
      const direction = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
      const dot = (axis: readonly number[]) => direction[0]! * axis[0]! + direction[1]! * axis[1]! + direction[2]! * axis[2]!
      const depth = dot(pose.direction)
      if (depth <= 0) continue
      const x = (width - 1) / 2 + focalPixels * dot(pose.right) / depth
      const y = (height - 1) / 2 - focalPixels * dot(pose.up) / depth
      const radius = 5
      if (x < -radius || y < -radius || x > width - 1 + radius || y > height - 1 + radius) continue
      const peak = Math.min(100000, 12000 * Math.pow(10, -0.4 * (star.magnitude - 8)))
      for (let row = Math.max(0, Math.ceil(y - radius)); row <= Math.min(height - 1, Math.floor(y + radius)); row++) {
        for (let column = Math.max(0, Math.ceil(x - radius)); column <= Math.min(width - 1, Math.floor(x + radius)); column++) {
          const distanceSquared = (column - x) ** 2 + (row - y) ** 2
          intensity[row * width + column]! += peak * Math.exp(-distanceSquared / (2 * 1.15 ** 2))
        }
      }
    }
  }
  return Uint16Array.from(intensity, value => Math.min(32767, Math.max(0, Math.round(value))))
}
