import { describe, expect, it } from 'vitest'
import { measureAutofocusStars, measureStars } from './statistics.js'
import type { ImageColor } from './preview.js'

type Star = {
  x: number
  y: number
  sigma: number
  amplitude?: number
  profile?: 'exponential' | 'doughnut'
  width?: number
}

function image(
  stars: Star[],
  options: {
    width?: number
    height?: number
    background?: number
    noise?: number
    color?: ImageColor
    clip?: number
  } = {},
) {
  const width = options.width ?? 96
  const height = options.height ?? 96
  const pixels = new Float64Array(width * height)
  let seed = 17

  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0

    return (seed + 1) / 4294967297
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let signal = 0

      // Independently integrate the continuous Gaussian over detector pixel area.
      for (const star of stars) {
        if (Math.hypot(x - star.x, y - star.y) > star.sigma * 9) continue

        for (let sy = 0; sy < 12; sy++) {
          for (let sx = 0; sx < 12; sx++) {
            const r2 = (x + (sx + 0.5) / 12 - 0.5 - star.x) ** 2 + (y + (sy + 0.5) / 12 - 0.5 - star.y) ** 2
            const r = Math.sqrt(r2)

            const exponents = {
              exponential: -r / star.sigma,
              doughnut: -((r - star.sigma) ** 2) / (2 * (star.width ?? 3) ** 2),
              gaussian: -r2 / (2 * star.sigma ** 2),
            }

            const exponent = exponents[star.profile ?? 'gaussian']

            signal += (star.amplitude ?? 1000) * Math.exp(exponent) / 144
          }
        }
      }

      // SAFETY: Bayer patterns contain four r/g/b characters; parity indexes stay within 0–3.
      const gain = options.color?.kind === 'bayer'
        ? { r: 1.8, g: 1, b: 0.45 }[options.color.pattern[(y % 2) * 2 + x % 2] as 'r' | 'g' | 'b']
        : 1

      const noise = (options.noise ?? 0) * Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())
      pixels[y * width + x] = Math.min(options.clip ?? Infinity, (signal + (options.background ?? 100)) * gain + noise)
    }
  }

  return { width, height, pixels }
}

const expected = (sigma: number) => sigma * Math.sqrt(2 * Math.log(2))

describe('measureStars', () => {
  it('measures true enclosed Gaussian half-flux across brightness, negative backgrounds and subpixel centers', async () => {
    for (const sigma of [1.5, 2, 3]) {
      for (const offset of [0, 0.23, 0.5]) {
        for (const amplitude of [200, 20000]) {
          const frame = image([{ x: 46 + offset, y: 47 + offset, sigma, amplitude }], { background: -130, noise: 1 })
          const result = await measureStars(frame.width, frame.height, frame.pixels)
          expect(result.detectedStars).toBe(1)
          expect(Math.abs(result.medianHfrPixels! - expected(sigma))).toBeLessThan(0.11)
        }
      }
    }
  })

  it('measures enclosed flux for a non-Gaussian exponential profile', async () => {
    const scale = 1.5
    const frame = image([{ x: 46.23, y: 47.5, sigma: scale, profile: 'exponential' }])
    const result = await measureStars(frame.width, frame.height, frame.pixels)
    expect(result.detectedStars).toBe(1)
    // Circular exponential enclosed flux is 1 - exp(-r/s) * (1 + r/s).
    // Its half-flux root is 1.67835s; the flux-weighted mean radius would be 2s.
    expect(Math.abs(result.medianHfrPixels! - 1.67834699001666 * scale)).toBeLessThan(0.11)
  })

  it('rejects malformed image data instead of claiming a valid starless image', async () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      const pixels = new Float64Array(33 * 33)
      pixels[pixels.length - 1] = value
      await expect(measureStars(33, 33, pixels, { kind: 'bayer', pattern: 'rggb' })).rejects.toThrow('nonfinite')
    }

    await expect(measureStars(32, 32, new Float64Array(1024).fill(NaN))).rejects.toThrow('nonfinite')

    for (const [width, height, length] of [[0, 1, 0], [1.5, 2, 3], [2, 2, 3], [50000001, 1, 50000001]]) {
      await expect(measureStars(width!, height!, { length: length! })).rejects.toThrow('dimensions')
    }
  })

  it('reports the median of measured isolated stars', async () => {
    const frame = image([
      { x: 24, y: 24, sigma: 1.5 },
      { x: 66, y: 24, sigma: 2 },
      { x: 45, y: 68, sigma: 3 },
    ])

    const result = await measureStars(frame.width, frame.height, frame.pixels)
    expect(result.detectedStars).toBe(3)
    expect(Math.abs(result.medianHfrPixels! - expected(2))).toBeLessThan(0.11)
  })

  it('uses native Bayer luminance and preserves the detector pixel radius for every pattern', async () => {
    for (const pattern of ['rggb', 'grbg', 'gbrg', 'bggr'] as const) {
      for (const sigma of [2, 3]) {
        const color: ImageColor = { kind: 'bayer', pattern }
        const frame = image([{ x: 46.23, y: 47.5, sigma }], { color, noise: 1 })
        const result = await measureStars(frame.width, frame.height, frame.pixels, color)
        expect(result.detectedStars).toBe(1)
        expect(Math.abs(result.medianHfrPixels! - expected(sigma))).toBeLessThan(0.22)
      }
    }
  })

  it('returns no measurement for blank, noisy, invalid and isolated hot-pixel images', async () => {
    for (const color of [{ kind: 'mono' }, { kind: 'bayer', pattern: 'rggb' }] satisfies ImageColor[]) {
      for (const noise of [0, 10]) {
        const frame = image([], { color, noise })
        expect(await measureStars(frame.width, frame.height, frame.pixels, color)).toEqual({ detectedStars: 0, medianHfrPixels: null })
        frame.pixels[47 * frame.width + 46] = 50000
        expect(await measureStars(frame.width, frame.height, frame.pixels, color)).toEqual({ detectedStars: 0, medianHfrPixels: null })
      }
    }

  })

  it('rejects nonfinite star patches and clipping in Bayer data without assuming a sensor ceiling', async () => {
    const frame = image([{ x: 45, y: 45, sigma: 2 }])
    frame.pixels[45 * frame.width + 45] = NaN
    await expect(measureStars(frame.width, frame.height, frame.pixels)).rejects.toThrow('nonfinite')

    for (const pattern of ['rggb', 'grbg', 'gbrg', 'bggr'] as const) {
      const color: ImageColor = { kind: 'bayer', pattern }
      const clipped = image([{ x: 45, y: 45, sigma: 3, amplitude: 10000 }], { color, clip: 500 })
      expect(await measureStars(clipped.width, clipped.height, clipped.pixels, color)).toEqual({ detectedStars: 0, medianHfrPixels: null })
    }
  })

  it('yields to device and request work before completing a large image', async () => {
    let complete = false

    const operation = measureStars(1024, 1024, new Float32Array(1024 * 1024)).then(result => {
      complete = true

      return result
    })

    await new Promise<void>(resolve => setImmediate(resolve))
    expect(complete).toBe(false)
    expect(await operation).toEqual({ detectedStars: 0, medianHfrPixels: null })
  })

  it('rejects incomplete edge apertures, close blends, flat clipped cores and unconverged broad profiles', async () => {
    const frames = [
      image([{ x: 10, y: 45, sigma: 2 }]),
      image([{ x: 42, y: 45, sigma: 2 }, { x: 50, y: 45, sigma: 2 }]),
      image([{ x: 45, y: 45, sigma: 2 }], { clip: 400 }),
      image([{ x: 45, y: 45, sigma: 8 }]),
    ]

    for (const frame of frames) {
      expect(await measureStars(frame.width, frame.height, frame.pixels))
        .toEqual({ detectedStars: 0, medianHfrPixels: null })
    }
  })

  it('measures defocused doughnuts that capture star measurements reject', async () => {
    const frame = image(
      [{ x: 100, y: 100, sigma: 14, profile: 'doughnut', amplitude: 1200, width: 3.5 }],
      { width: 200, height: 200 },
    )

    expect(await measureStars(frame.width, frame.height, frame.pixels)).toEqual({ detectedStars: 0, medianHfrPixels: null })
    const autofocus = await measureAutofocusStars(frame.width, frame.height, frame.pixels)
    expect(autofocus.detectedStars).toBeGreaterThan(0)
    expect(autofocus.medianHfrPixels).toBeGreaterThan(6)
  })
})
