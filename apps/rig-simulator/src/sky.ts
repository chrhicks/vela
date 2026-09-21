import { setImmediate } from 'node:timers/promises'
import type { Star } from './catalog.js'
import type { CameraPose } from './mount.js'

export interface RenderOptions {
  width: number
  height: number
  fieldHeightDegrees: number
  seed: number
  obscured?: boolean
  sensor?: 'monochrome' | 'rggb'
  exposureSeconds?: number
}

// Keep the guide camera's signed FITS range and 2-second baseline unchanged.
// The color camera exercises the FRA's full unsigned 16-bit acquisition range.
const maximumPixels = 6248 * 4176

const stripePixelBudget = 65536

const syntheticColors = [
  [1.6, 0.8, 0.4],
  [1, 1, 1],
  [0.4, 0.9, 1.7],
] as const

// D05 supplies positions and magnitude, not RGB. These repeatable warm, neutral,
// and cool assignments test color reconstruction; they are not measured colors.
export function syntheticStarColor(star: Star): readonly [number, number, number] {
  const coordinate = Math.round(star.raDegrees * 1000) + Math.round((star.decDegrees + 90) * 1000)

  return syntheticColors[((coordinate % 3) + 3) % 3]!
}

interface ProjectedStar {
  x: number
  y: number
  peak: number
  color: readonly [number, number, number]
}

export function renderSky(
  stars: readonly Star[],
  pose: CameraPose,
  options: RenderOptions,
): Uint16Array {
  const steps = renderStripes(stars, pose, options)
  let step = steps.next()

  while (!step.done) step = steps.next()

  return step.value
}

export async function renderSkyAsync(
  stars: readonly Star[],
  pose: CameraPose,
  options: RenderOptions,
  signal?: AbortSignal,
): Promise<Uint16Array> {
  const steps = renderStripes(stars, pose, options)

  try {
    while (true) {
      signal?.throwIfAborted()
      const step = steps.next()

      if (step.done) return step.value
      // Yield to device reads, stop and disconnect requests during generation.
      await setImmediate(undefined, { signal })
    }
  } finally {
    steps.return(new Uint16Array())
  }
}

function* renderStripes(
  stars: readonly Star[],
  pose: CameraPose,
  options: RenderOptions,
): Generator<void, Uint16Array> {
  const { width, height, fieldHeightDegrees } = options
  const exposureScale = (options.exposureSeconds ?? 2) / 2
  const colorSensor = options.sensor === 'rggb'

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 6248 ||
    height > 6248 ||
    width * height > maximumPixels ||
    !Number.isFinite(fieldHeightDegrees) ||
    fieldHeightDegrees <= 0 ||
    fieldHeightDegrees >= 180 ||
    !Number.isFinite(exposureScale) ||
    exposureScale < 0 ||
    (options.sensor !== undefined && options.sensor !== 'monochrome' && options.sensor !== 'rggb')
  ) {
    throw new Error('Invalid sky image dimensions, field height, sensor or exposure')
  }

  // Only the final Uint16 frame scales with area. Float64 scratch stays bounded,
  // and preserves addition/rounding of the original mono renderer.
  const stripeRows = Math.max(1, Math.floor(stripePixelBudget / width))

  const stripes: ProjectedStar[][] = Array.from(
    { length: Math.ceil(height / stripeRows) },
    () => [],
  )

  const focalPixels = height / (2 * Math.tan((fieldHeightDegrees * Math.PI) / 360))
  // Both cameras share focused optics. Color changes spectral response, not
  // star width; unnecessarily broad stars blend in crowded Milky Way fields.
  const sigma = 1.15
  const radius = colorSensor ? 8 : 5

  if (!options.obscured) {
    for (let index = 0; index < stars.length; index++) {
      if (index % 512 === 0) yield
      const star = stars[index]!
      const ra = (star.raDegrees * Math.PI) / 180
      const dec = (star.decDegrees * Math.PI) / 180

      const direction = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]

      const dot = (axis: readonly number[]) =>
        direction[0]! * axis[0]! + direction[1]! * axis[1]! + direction[2]! * axis[2]!

      const depth = dot(pose.direction)

      if (depth <= 0) continue
      const x = (width - 1) / 2 + (focalPixels * dot(pose.right)) / depth
      const y = (height - 1) / 2 - (focalPixels * dot(pose.up)) / depth

      if (x < -radius || y < -radius || x > width - 1 + radius || y > height - 1 + radius) continue

      const peak =
        Math.min(100000, 12000 * Math.pow(10, -0.4 * (star.magnitude - 8))) * exposureScale

      const projected = { x, y, peak, color: syntheticStarColor(star) }
      const firstStripe = Math.floor(Math.max(0, Math.ceil(y - radius)) / stripeRows)
      const lastStripe = Math.floor(Math.min(height - 1, Math.floor(y + radius)) / stripeRows)

      for (let stripe = firstStripe; stripe <= lastStripe; stripe++)
        stripes[stripe]!.push(projected)
    }
  }

  const pixels = new Uint16Array(width * height)
  const intensity = new Float64Array(Math.min(height, stripeRows) * width)
  const maximum = colorSensor ? 65535 : 32767
  let randomState = options.seed >>> 0

  for (let stripe = 0; stripe < stripes.length; stripe++) {
    yield
    const firstRow = stripe * stripeRows
    const endRow = Math.min(height, firstRow + stripeRows)
    const count = (endRow - firstRow) * width

    for (let index = 0; index < count; index++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
      // A fixed bias plus a small exposure-dependent sky floor and read noise.
      // This is a useful signal model, not calibrated sensor/shot-noise physics.
      intensity[index] = 480 + 20 * exposureScale + (randomState / 4294967296 - 0.5) * 12
    }

    const stripeStars = stripes[stripe]!

    for (let starIndex = 0; starIndex < stripeStars.length; starIndex++) {
      if (starIndex > 0 && starIndex % 128 === 0) yield
      const { x, y, peak, color } = stripeStars[starIndex]!

      for (
        let row = Math.max(firstRow, Math.ceil(y - radius));
        row <= Math.min(endRow - 1, Math.floor(y + radius));
        row++
      ) {
        for (
          let column = Math.max(0, Math.ceil(x - radius));
          column <= Math.min(width - 1, Math.floor(x + radius));
          column++
        ) {
          const distanceSquared = (column - x) ** 2 + (row - y) ** 2
          // Full sensor origin (0,0): R G / G B. No debayering at this boundary.
          const channel = row % 2 === 0 ? column % 2 : 1 + (column % 2)
          const transmission = colorSensor ? color[channel]! : 1
          intensity[(row - firstRow) * width + column]! +=
            peak * Math.exp(-distanceSquared / (2 * sigma ** 2)) * transmission
        }
      }
    }

    for (let index = 0; index < count; index++) {
      pixels[firstRow * width + index] = Math.min(
        maximum,
        Math.max(0, Math.round(intensity[index]!)),
      )
    }
  }

  return pixels
}
