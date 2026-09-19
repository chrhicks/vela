import { setImmediate } from 'node:timers/promises'

import type { ImageColor } from './preview.js'

type Background = { level: number, noise: number }

type Peak = { x: number, y: number }

interface StarPolicy {
  aperture: number
  patchRadius: number
  isolation: number
  peakSigma: number
  peakWindow: number
  centroidRadius: number
  centroidWander: number
  annulusInner: number
  outerFluxFraction: number
  elongation: number
  minHfrMono: number
  minHfrBayer: number
  mergeBlends: boolean
}

const capturePolicy: StarPolicy = {
  aperture: 12, patchRadius: 16, isolation: 12, peakSigma: 8, peakWindow: 1,
  centroidRadius: 8, centroidWander: 3, annulusInner: 13, outerFluxFraction: 0.04, elongation: 0.65,
  minHfrMono: 0.9, minHfrBayer: 1.4, mergeBlends: false,
}

const autofocusPolicy: StarPolicy = {
  aperture: 40, patchRadius: 48, isolation: 48, peakSigma: 5, peakWindow: 2,
  centroidRadius: 28, centroidWander: 10, annulusInner: 41, outerFluxFraction: 0.4, elongation: 0.9,
  minHfrMono: 0.5, minHfrBayer: 0.8, mergeBlends: true,
}

/** Conservative measurements of isolated, adequately sampled stars in linear image data. */
export async function measureStars(width: number, height: number, pixels: ArrayLike<number>, color: ImageColor = { kind: 'mono' }, policy: StarPolicy = capturePolicy) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 50_000_000 || pixels.length !== width * height) throw new Error('Invalid image dimensions')

  // Every sample matters: invalid edges and unused Bayer pixels must not look starless.
  for (let index = 0; index < pixels.length; index++) {
    if (!Number.isFinite(pixels[index])) throw new Error('Image contains nonfinite samples')

    if (index % 131072 === 0) await setImmediate()
  }

  const scale = color.kind === 'bayer' ? 2 : 1

  const sample = (x: number, y: number) => {
    const index = y * scale * width + x * scale

    return scale === 1 ? pixels[index]! : (pixels[index]! + pixels[index + 1]! + pixels[index + width]! + pixels[index + width + 1]!) / 4
  }

  const columns = Math.floor(width / scale)
  const rows = Math.floor(height / scale)
  const tileSize = 64
  const tileColumns = Math.ceil(columns / tileSize)
  const backgrounds: Background[] = []

  for (let top = 0; top < rows; top += tileSize) {
    for (let left = 0; left < columns; left += tileSize) {
      const values: number[] = []

      for (let y = top; y < Math.min(rows, top + tileSize); y += 4) {
        for (let x = left; x < Math.min(columns, left + tileSize); x += 4) values.push(sample(x, y))
      }

      backgrounds.push(background(values))
    }

    await setImmediate()
  }

  const peaks: Peak[] = []
  const edge = policy.peakWindow

  for (let y = edge; y < rows - edge; y++) {
    for (let x = edge; x < columns - edge; x++) {
      const sky = backgrounds[Math.floor(y / tileSize) * tileColumns + Math.floor(x / tileSize)]!
      const value = sample(x, y)

      if (!(value > sky.level + policy.peakSigma * sky.noise)) continue
      let support = 0
      let maximum = true

      for (let dy = -edge; dy <= edge; dy++) {
        for (let dx = -edge; dx <= edge; dx++) {
          if (dx === 0 && dy === 0) continue
          const neighbor = sample(x + dx, y + dy)

          if (neighbor > value || (neighbor === value && (dy < 0 || (dy === 0 && dx < 0)))) maximum = false

          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && neighbor > sky.level + 3 * sky.noise) support++
        }
      }

      if (maximum && support >= 4) peaks.push({ x: x * scale + (scale - 1) / 2, y: y * scale + (scale - 1) / 2 })
    }

    if (y % 32 === 0) await setImmediate()
  }

  const radii: number[] = []
  // Spatial buckets keep blend rejection linear even in a rich field.
  const buckets = new Map<string, Peak[]>()

  for (const peak of peaks) {
    const key = `${Math.floor(peak.x / policy.isolation)},${Math.floor(peak.y / policy.isolation)}`
    const bucket = buckets.get(key) ?? []
    bucket.push(peak)
    buckets.set(key, bucket)
  }

  if (policy.mergeBlends) {
    const remaining = [...peaks]

    while (remaining.length) {
      const seed = remaining.pop()!
      const cluster = [seed]

      for (let index = remaining.length - 1; index >= 0; index--) {
        const candidate = remaining[index]!

        if (Math.hypot(candidate.x - seed.x, candidate.y - seed.y) < policy.isolation) {
          cluster.push(candidate)
          remaining.splice(index, 1)
        }
      }

      const merged = {
        x: cluster.reduce((sum, peak) => sum + peak.x, 0) / cluster.length,
        y: cluster.reduce((sum, peak) => sum + peak.y, 0) / cluster.length,
      }

      const hfr = measureStar(width, height, pixels, color, merged, policy)

      if (hfr !== null) radii.push(hfr)

      if (remaining.length % 8 === 0) await setImmediate()
    }
  } else {
    for (let index = 0; index < peaks.length; index++) {
      const peak = peaks[index]!
      const bx = Math.floor(peak.x / policy.isolation)
      const by = Math.floor(peak.y / policy.isolation)
      let blended = false

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
            if (other !== peak && Math.hypot(other.x - peak.x, other.y - peak.y) < policy.isolation) blended = true
          }
        }
      }

      if (!blended) {
        const hfr = measureStar(width, height, pixels, color, peak, policy)

        if (hfr !== null) radii.push(hfr)
      }

      if (index % 8 === 0) await setImmediate()
    }
  }

  return { detectedStars: radii.length, medianHfrPixels: radii.length ? median(radii) : null }
}

/** Defocus-capable HFR for an autofocus walk. Capture continues to use measureStars. */
export async function measureAutofocusStars(width: number, height: number, pixels: ArrayLike<number>, color: ImageColor = { kind: 'mono' }) {
  return measureStars(width, height, pixels, color, autofocusPolicy)
}

function median(values: number[]) {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)

  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

function background(values: number[]): Background {
  const finite = values.filter(Number.isFinite)

  if (!finite.length) return { level: NaN, noise: NaN }
  const level = median(finite)
  // A numerical floor permits noiseless floating-point fixtures without treating rounding as signal.
  const noise = Math.max(1.4826 * median(finite.map(value => Math.abs(value - level))), Math.max(1, Math.abs(level)) * 1e-9)

  return { level, noise }
}

function luminance(width: number, pixels: ArrayLike<number>, color: ImageColor, x: number, y: number) {
  const value = (dx: number, dy: number) => pixels[(y + dy) * width + x + dx]!

  if (color.kind === 'mono') return value(0, 0)
  const channel = color.pattern[(y % 2) * 2 + x % 2]!
  const center = value(0, 0)

  if (channel === 'g') {
    const horizontal = (value(-1, 0) + value(1, 0)) / 2
    const vertical = (value(0, -1) + value(0, 1)) / 2

    return (center + horizontal + vertical) / 3
  }

  const green = (value(-1, 0) + value(1, 0) + value(0, -1) + value(0, 1)) / 4
  const opposite = (value(-1, -1) + value(1, -1) + value(-1, 1) + value(1, 1)) / 4

  return (center + green + opposite) / 3
}

function measureStar(width: number, height: number, pixels: ArrayLike<number>, color: ImageColor, peak: Peak, policy: StarPolicy): number | null {
  const ox = Math.round(peak.x)
  const oy = Math.round(peak.y)
  const { aperture, patchRadius } = policy

  if (ox <= patchRadius || oy <= patchRadius || ox >= width - patchRadius - 1 || oy >= height - patchRadius - 1) return null
  const patch: { x: number, y: number, value: number }[] = []
  const annulus: number[] = []

  for (let y = -patchRadius; y <= patchRadius; y++) {
    for (let x = -patchRadius; x <= patchRadius; x++) {
      const value = luminance(width, pixels, color, ox + x, oy + y)

      if (!Number.isFinite(value)) return null
      patch.push({ x, y, value })

      if (Math.hypot(x, y) >= policy.annulusInner) annulus.push(value)
    }
  }

  const sky = background(annulus)
  let cx = 0
  let cy = 0

  for (let iteration = 0; iteration < 3; iteration++) {
    let flux = 0
    let mx = 0
    let my = 0

    for (const pixel of patch) {
      if (Math.hypot(pixel.x - cx, pixel.y - cy) > policy.centroidRadius) continue
      const signal = pixel.value - sky.level
      flux += signal
      mx += pixel.x * signal
      my += pixel.y * signal
    }

    if (!(flux > 0)) return null
    cx = mx / flux
    cy = my / flux

    if (Math.hypot(cx, cy) > policy.centroidWander) return null
  }

  let total = 0
  let outer = 0
  let mxx = 0
  let myy = 0
  let mxy = 0
  let maximum = -Infinity
  let maximumCount = 0

  for (const pixel of patch) {
    const dx = pixel.x - cx
    const dy = pixel.y - cy
    const radius = Math.hypot(dx, dy)
    const signal = pixel.value - sky.level

    if (radius <= aperture) {
      total += signal
      mxx += signal * dx * dx
      myy += signal * dy * dy
      mxy += signal * dx * dy

      if (pixel.value > maximum) {
        maximum = pixel.value
        maximumCount = 1
      } else if (pixel.value === maximum) maximumCount++
    } else if (radius <= patchRadius) outer += signal
  }

  if (!(total > 30 * sky.noise * Math.sqrt(Math.PI * aperture ** 2))) return null

  // Reject an obvious flat clipping plateau; sensor saturation levels are not assumed.
  if (maximumCount >= 5 || Math.abs(outer) > total * policy.outerFluxFraction) return null
  const trace = mxx + myy
  const separation = Math.hypot(mxx - myy, 2 * mxy)

  if (!(trace > 0) || separation > trace * policy.elongation) return null

  // Each pixel contributes signed, background-subtracted flux across its actual square area.
  // A fine radial histogram gives circular enclosed flux, not a weighted mean star radius.
  const binsPerPixel = 32
  const subdivisions = 8
  const bins = new Float64Array(aperture * binsPerPixel + 1)

  for (const pixel of patch) {
    if (Math.hypot(pixel.x - cx, pixel.y - cy) > aperture + 1) continue
    const flux = (pixel.value - sky.level) / subdivisions ** 2

    for (let sy = 0; sy < subdivisions; sy++) {
      for (let sx = 0; sx < subdivisions; sx++) {
        const dx = pixel.x - cx + (sx + 0.5) / subdivisions - 0.5
        const dy = pixel.y - cy + (sy + 0.5) / subdivisions - 0.5
        const bin = Math.floor(Math.hypot(dx, dy) * binsPerPixel)

        if (bin < bins.length) bins[bin]! += flux
      }
    }
  }

  total = bins.reduce((sum, flux) => sum + flux, 0)
  let enclosed = 0

  for (let bin = 0; bin < bins.length; bin++) {
    const flux = bins[bin]!

    if (enclosed + flux >= total / 2) {
      const radius = (bin + (total / 2 - enclosed) / flux) / binsPerPixel

      return radius >= (color.kind === 'mono' ? policy.minHfrMono : policy.minHfrBayer) ? radius : null
    }

    enclosed += flux
  }

  return null
}
