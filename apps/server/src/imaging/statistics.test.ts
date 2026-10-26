import { describe, expect, it, vi } from 'vitest'
import {
  capturePolicy,
  classify,
  findPeaks,
  measureAutofocusStars,
  measureStar,
  measureStars,
  axisRatioOf,
  summarize,
} from './statistics.js'
import type { ImageColor } from './preview.js'

type Star = {
  x: number
  y: number
  sigma: number
  amplitude?: number
  profile?: 'exponential' | 'doughnut'
  width?: number
  /** A Gaussian with this ratio of major to minor axis; sigma is the minor axis. */
  axisRatio?: number
  /** Direction of the major axis, in radians from the x axis. */
  angle?: number
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
        if (Math.hypot(x - star.x, y - star.y) > star.sigma * (star.axisRatio ?? 1) * 9) continue

        for (let sy = 0; sy < 12; sy++) {
          for (let sx = 0; sx < 12; sx++) {
            const dx = x + (sx + 0.5) / 12 - 0.5 - star.x
            const dy = y + (sy + 0.5) / 12 - 0.5 - star.y
            const r2 = dx ** 2 + dy ** 2
            const r = Math.sqrt(r2)
            const along = dx * Math.cos(star.angle ?? 0) + dy * Math.sin(star.angle ?? 0)
            const ratio = star.axisRatio ?? 1

            const exponents = {
              exponential: -r / star.sigma,
              doughnut: -((r - star.sigma) ** 2) / (2 * (star.width ?? 3) ** 2),
              gaussian: -((along / ratio) ** 2 + (r2 - along ** 2)) / (2 * star.sigma ** 2),
            }

            const exponent = exponents[star.profile ?? 'gaussian']

            signal += ((star.amplitude ?? 1000) * Math.exp(exponent)) / 144
          }
        }
      }

      // SAFETY: Bayer patterns contain four r/g/b characters; parity indexes stay within 0–3.
      const gain =
        options.color?.kind === 'bayer'
          ? { r: 1.8, g: 1, b: 0.45 }[
              options.color.pattern[(y % 2) * 2 + (x % 2)] as 'r' | 'g' | 'b'
            ]
          : 1

      const noise =
        (options.noise ?? 0) * Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random())

      pixels[y * width + x] = Math.min(
        options.clip ?? Infinity,
        (signal + (options.background ?? 100)) * gain + noise,
      )
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
          const frame = image([{ x: 46 + offset, y: 47 + offset, sigma, amplitude }], {
            background: -130,
            noise: 1,
          })

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
      await expect(
        measureStars(33, 33, pixels, { kind: 'bayer', pattern: 'rggb' }),
      ).rejects.toThrow('nonfinite')
    }

    await expect(measureStars(32, 32, new Float64Array(1024).fill(NaN))).rejects.toThrow(
      'nonfinite',
    )

    for (const [width, height, length] of [
      [0, 1, 0],
      [1.5, 2, 3],
      [2, 2, 3],
      [50000001, 1, 50000001],
    ]) {
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

  it('counts a sharp Bayer star that measures 1.2 px HFR, which the old 1.4 px floor rejected', async () => {
    for (const pattern of ['rggb', 'grbg', 'gbrg', 'bggr'] as const) {
      const color: ImageColor = { kind: 'bayer', pattern }
      // The 3x3 Bayer luminance widens a star this sharp: a Gaussian of 0.84 px HFR reads about 1.2.
      const frame = image([{ x: 46.23, y: 47.5, sigma: 0.84 / expected(1), amplitude: 5000 }], { color, noise: 1 })
      const result = await measureStars(frame.width, frame.height, frame.pixels, color)

      expect(result.detectedStars).toBe(1)
      expect(Math.abs(result.medianHfrPixels! - 1.2)).toBeLessThan(0.1)
    }
  })

  it('stamps its measurements with the algorithm version', async () => {
    const frame = image([{ x: 46, y: 47, sigma: 2 }])

    expect((await measureStars(frame.width, frame.height, frame.pixels)).algorithm).toEqual({ version: 2 })
    expect((await measureAutofocusStars(frame.width, frame.height, frame.pixels)).algorithm).toEqual({ version: 2 })
  })

  it('records what it found beside the count and accounts for every peak', async () => {
    const frame = image(
      [
        { x: 30, y: 30, sigma: 2, amplitude: 1000 },
        { x: 65, y: 30, sigma: 2, amplitude: 60 },
        { x: 30, y: 65, sigma: 2, amplitude: 14 },
        { x: 62, y: 65, sigma: 2 },
        { x: 68, y: 65, sigma: 2 },
        { x: 10, y: 45, sigma: 2 },
      ],
      { noise: 1 },
    )

    const result = await measureStars(frame.width, frame.height, frame.pixels)

    expect(result).toMatchObject({
      detectedStars: 2,
      detections: 6,
      measured: 2,
      strong: 1,
      rejected: { blended: 2, edge: 1, faint: 1, unconverged: 0, saturated: 0, wings: 0, elongated: 0, floor: 0 },
    })
    expect(Math.abs(result.sky - 100)).toBeLessThan(1)
    expect(Math.abs(result.noise - 1)).toBeLessThan(0.3)

    expect(result.detections).toBe(result.measured + Object.values(result.rejected).reduce((a, b) => a + b, 0))
  })

  it('counts blends merged for autofocus as one peak measured', async () => {
    const frame = image(
      [
        { x: 90, y: 100, sigma: 2 },
        { x: 98, y: 100, sigma: 2 },
      ],
      { width: 200, height: 200, noise: 1 },
    )

    const result = await measureAutofocusStars(frame.width, frame.height, frame.pixels)

    expect(result.detections).toBe(2)
    expect(result.measured + Object.values(result.rejected).reduce((a, b) => a + b, 0)).toBe(1)
  })

  it('returns no measurement for blank, noisy, invalid and isolated hot-pixel images', async () => {
    for (const color of [
      { kind: 'mono' },
      { kind: 'bayer', pattern: 'rggb' },
    ] satisfies ImageColor[]) {
      for (const noise of [0, 10]) {
        const frame = image([], { color, noise })
        expect(await measureStars(frame.width, frame.height, frame.pixels, color)).toMatchObject({
          detectedStars: 0,
          medianHfrPixels: null,
        })
        frame.pixels[47 * frame.width + 46] = 50000
        expect(await measureStars(frame.width, frame.height, frame.pixels, color)).toMatchObject({
          detectedStars: 0,
          medianHfrPixels: null,
        })
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
      expect(await measureStars(clipped.width, clipped.height, clipped.pixels, color)).toMatchObject({
        detectedStars: 0,
        medianHfrPixels: null,
      })
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
    expect(await operation).toMatchObject({ detectedStars: 0, medianHfrPixels: null })
  })

  it('rejects incomplete edge apertures, close blends, flat clipped cores and unconverged broad profiles', async () => {
    const frames = [
      image([{ x: 10, y: 45, sigma: 2 }]),
      image([
        { x: 42, y: 45, sigma: 2 },
        { x: 50, y: 45, sigma: 2 },
      ]),
      image([{ x: 45, y: 45, sigma: 2 }], { clip: 400 }),
      image([{ x: 45, y: 45, sigma: 8 }]),
    ]

    for (const frame of frames) {
      expect(await measureStars(frame.width, frame.height, frame.pixels)).toMatchObject({
        detectedStars: 0,
        medianHfrPixels: null,
      })
    }
  })

  it('measures defocused doughnuts that capture star measurements reject', async () => {
    const frame = image(
      [{ x: 100, y: 100, sigma: 14, profile: 'doughnut', amplitude: 1200, width: 3.5 }],
      { width: 200, height: 200 },
    )

    expect(await measureStars(frame.width, frame.height, frame.pixels)).toMatchObject({
      detectedStars: 0,
      medianHfrPixels: null,
    })
    const autofocus = await measureAutofocusStars(frame.width, frame.height, frame.pixels)
    expect(autofocus.detectedStars).toBeGreaterThan(0)
    expect(autofocus.medianHfrPixels).toBeGreaterThan(6)
  })
})

describe('star measurement stages', () => {
  const mono: ImageColor = { kind: 'mono' }

  /** Measures the peak nearest the first star; later stars overlap it. */
  async function verdictFor(stars: Star | Star[], options: Parameters<typeof image>[1] = {}) {
    const list = [stars].flat()
    const star = list[0]!
    const frame = image(list, { noise: 1, ...options })
    const { peaks } = await findPeaks(frame.width, frame.height, frame.pixels, mono, capturePolicy)
    const distance = (peak: { x: number; y: number }) => Math.hypot(peak.x - star.x, peak.y - star.y)
    const nearest = peaks.sort((a, b) => distance(a) - distance(b))[0]!

    const measurement = measureStar(
      frame.width,
      frame.height,
      frame.pixels,
      mono,
      nearest,
      capturePolicy,
    )

    return { measurement, verdict: classify(measurement, capturePolicy, mono) }
  }

  it('finds one peak at each star center', async () => {
    const frame = image(
      [
        { x: 24, y: 30, sigma: 2 },
        { x: 66, y: 60, sigma: 2 },
      ],
      { noise: 1 },
    )

    const { peaks } = await findPeaks(frame.width, frame.height, frame.pixels, mono, capturePolicy)

    expect(peaks).toEqual([
      { x: 24, y: 30 },
      { x: 66, y: 60 },
    ])
  })

  it('reports the frame sky as the median tile background', async () => {
    const frame = image([{ x: 24, y: 30, sigma: 2 }], { background: 340, noise: 2 })
    const { sky } = await findPeaks(frame.width, frame.height, frame.pixels, mono, capturePolicy)

    expect(Math.abs(sky.level - 340)).toBeLessThan(1)
    expect(Math.abs(sky.noise - 2)).toBeLessThan(0.6)
  })

  it('accepts a measured star and keeps its half-flux radius', async () => {
    const { measurement, verdict } = await verdictFor({ x: 46, y: 47, sigma: 2 })

    expect(measurement).toMatchObject({ ok: true })
    expect(verdict.ok).toBe(true)
    expect(Math.abs((verdict.ok ? verdict.hfr : NaN) - expected(2))).toBeLessThan(0.11)
  })

  it('measures a faint star fully and names the gate that rejects it', async () => {
    const { measurement, verdict } = await verdictFor({ x: 46, y: 47, sigma: 2, amplitude: 8 })

    expect(measurement.ok && measurement.halfFluxRadius()).toEqual(expect.any(Number))
    expect(verdict).toEqual({ ok: false, reason: 'faint' })
  })

  it('names the first gate a star fails', async () => {
    const cases = [
      { reason: 'edge', star: { x: 10, y: 45, sigma: 2 }, options: { noise: 0 } },
      { reason: 'saturated', star: { x: 45, y: 45, sigma: 2 }, options: { clip: 400 } },
      { reason: 'wings', star: { x: 45, y: 45, sigma: 8 }, options: {} },
      {
        reason: 'floor',
        star: { x: 45.3, y: 45.4, sigma: 0.55, amplitude: 20000 },
        options: {},
      },
    ]

    for (const { reason, star, options } of cases)
      expect((await verdictFor(star, options)).verdict).toEqual({ ok: false, reason })
  })

  it('names the earlier gate when a star fails two', async () => {
    const cases = [
      {
        // Clipped just above the detection threshold: a flat plateau of too little light.
        reason: 'faint',
        star: { x: 45, y: 45, sigma: 2, amplitude: 20 },
        options: { clip: 112 },
      },
      {
        // A clipped core inside a broad halo that also fails the wings gate.
        reason: 'saturated',
        star: [
          { x: 45, y: 45, sigma: 2, amplitude: 1000 },
          { x: 45, y: 45, sigma: 8, amplitude: 300 },
        ],
        options: { clip: 400 },
      },
    ]

    for (const { reason, star, options } of cases)
      expect((await verdictFor(star, options)).verdict).toEqual({ ok: false, reason })
  })

  it('leaves the half-flux radius uncomputed for every star a cheaper gate rejects', async () => {
    const cases = [
      { star: { x: 46, y: 47, sigma: 2, amplitude: 8 }, options: {} },
      { star: { x: 45, y: 45, sigma: 2 }, options: { clip: 400 } },
      { star: { x: 45, y: 45, sigma: 8 }, options: {} },
    ]

    for (const { star, options } of cases) {
      const { measurement } = await verdictFor(star, options)

      if (!measurement.ok) throw new Error('expected a measurement')
      const halfFluxRadius = vi.fn(measurement.halfFluxRadius)

      expect(classify({ ...measurement, halfFluxRadius }, capturePolicy, mono).ok).toBe(false)
      expect(halfFluxRadius).not.toHaveBeenCalled()
    }
  })

  it('summarizes the stars that passed and counts the rest by the gate that rejected them', () => {
    const sky = { level: 340, noise: 4 }

    expect(
      summarize(
        [
          { ok: true, hfr: 3, snr: 250 },
          { ok: false, reason: 'blended' },
          { ok: true, hfr: 1, snr: 100 },
          { ok: false, reason: 'elongated' },
          { ok: true, hfr: 2, snr: 99.9 },
          { ok: false, reason: 'blended' },
        ],
        9,
        sky,
        [1.1, 1.3, 1.2, 1.5, 1.4, 1.3, 1.3, 1.2, 1.4, 1.3],
      ),
    ).toEqual({
      algorithm: { version: 2 },
      detectedStars: 3,
      medianHfrPixels: 2,
      detections: 9,
      measured: 3,
      strong: 2,
      rejected: {
        blended: 2,
        edge: 0,
        unconverged: 0,
        faint: 0,
        saturated: 0,
        wings: 0,
        elongated: 1,
        floor: 0,
      },
      sky: 340,
      noise: 4,
      axisRatio: 1.3,
    })

    expect(summarize([{ ok: false, reason: 'faint' }], 1, sky, [])).toMatchObject({
      detectedStars: 0,
      medianHfrPixels: null,
      detections: 1,
      measured: 0,
      strong: 0,
      rejected: { faint: 1 },
      axisRatio: null,
    })
  })

  it('records a frame axis ratio only from enough stars', () => {
    const sky = { level: 340, noise: 4 }

    expect(summarize([], 0, sky, Array(9).fill(1.4)).axisRatio).toBeNull()
    expect(summarize([], 0, sky, Array(10).fill(1.4)).axisRatio).toBe(1.4)
  })
})

describe('axis ratio of strong stars', () => {
  // The Soul night's sky and noise, as the rig's Bayer sensor records them.
  const rig = { background: 539, noise: 13.7, color: { kind: 'bayer', pattern: 'rggb' } satisfies ImageColor }

  /** Stars of one profile, each in its own 64 px cell of a 5 by 2 grid, at the given total flux in ADU. */
  function field(profile: { sigma: number; axisRatio: number }, flux: number, count = 10) {
    const amplitude = flux / (2 * Math.PI * profile.sigma ** 2 * profile.axisRatio)

    const stars = Array.from({ length: count }, (_, index) => ({
      x: 32 + 64 * (index % 5) + 0.37 * (index % 4),
      y: 32 + 64 * Math.floor(index / 5) + 0.21 * (index % 3),
      angle: (index * Math.PI) / 10,
      amplitude,
      ...profile,
    }))

    return image(stars, { width: 320, height: 128, ...rig })
  }

  // About S/N 210 by the measurement's own noise estimate.
  const strongFlux = 26_000

  it('recovers a known axis ratio from 1.0 to 2.0 to within 10% below it, and reads round stars 1.0 to 1.1', { timeout: 60_000 }, async () => {
    for (const sigma of [1.3, 2]) {
      for (const axisRatio of [1, 1.2, 1.5, 2]) {
        const frame = field({ sigma, axisRatio }, strongFlux)
        const { axisRatio: measured } = await measureStars(frame.width, frame.height, frame.pixels, rig.color)

        expect(measured, `sigma ${sigma}, axis ratio ${axisRatio}`).toBeGreaterThan(axisRatio * 0.9)
        expect(measured).toBeLessThan(axisRatio === 1 ? 1.1 : axisRatio * 1.02)
      }
    }
  })

  it('records no axis ratio from stars below the S/N the profile needs', async () => {
    const frame = field({ sigma: 1.8, axisRatio: 1.5 }, 12_000)
    const result = await measureStars(frame.width, frame.height, frame.pixels, rig.color)

    expect(result.measured).toBeGreaterThanOrEqual(8)
    expect(result.strong).toBeLessThan(10)
    expect(result.axisRatio).toBeNull()
  })

  it('records no axis ratio from fewer than ten strong stars', async () => {
    const profile = { sigma: 1.8, axisRatio: 1.5 }
    const nine = field(profile, strongFlux, 9)
    const ten = field(profile, strongFlux)

    expect((await measureStars(nine.width, nine.height, nine.pixels, rig.color)).axisRatio).toBeNull()
    expect((await measureStars(ten.width, ten.height, ten.pixels, rig.color)).axisRatio).toBeGreaterThan(1.3)
  })

  it('keeps trailed stars the profile gate rejects, and leaves the count and gate as they were', async () => {
    const trailed = field({ sigma: 1.1, axisRatio: 3 }, strongFlux)
    const result = await measureStars(trailed.width, trailed.height, trailed.pixels, rig.color)

    expect(result.rejected.elongated).toBeGreaterThanOrEqual(8)
    expect(result.detectedStars).toBeLessThanOrEqual(2)
    expect(result.axisRatio).toBeGreaterThan(2.4)
  })

  it('computes the moments only for stars that reach the profile gate with S/N 200 or more', async () => {
    const mono: ImageColor = { kind: 'mono' }

    const cases = [
      { star: { x: 46, y: 47, sigma: 2, amplitude: 8 }, options: {}, computed: false },
      { star: { x: 45, y: 45, sigma: 2 }, options: { clip: 400 }, computed: false },
      { star: { x: 45, y: 45, sigma: 8 }, options: {}, computed: false },
      { star: { x: 46, y: 47, sigma: 2, amplitude: 150 }, options: {}, computed: false },
      { star: { x: 46, y: 47, sigma: 2, amplitude: 400 }, options: {}, computed: true },
    ]

    for (const { star, options, computed } of cases) {
      const frame = image([star], { noise: 1, ...options })
      const { peaks } = await findPeaks(frame.width, frame.height, frame.pixels, mono, capturePolicy)
      const distance = (peak: { x: number; y: number }) => Math.hypot(peak.x - star.x, peak.y - star.y)
      const nearest = peaks.sort((a, b) => distance(a) - distance(b))[0]!
      const measurement = measureStar(frame.width, frame.height, frame.pixels, mono, nearest, capturePolicy)

      if (!measurement.ok) throw new Error('expected a measurement')
      const axisRatio = vi.fn(measurement.axisRatio)

      expect(axisRatioOf({ ...measurement, axisRatio }, capturePolicy) !== null).toBe(computed)
      expect(axisRatio).toHaveBeenCalledTimes(computed ? 1 : 0)
    }
  })

  it('reads no axis ratio in an autofocus measurement', async () => {
    const frame = field({ sigma: 1.8, axisRatio: 1.5 }, strongFlux)

    expect((await measureAutofocusStars(frame.width, frame.height, frame.pixels, rig.color)).axisRatio).toBeNull()
  })
})
