import { expect, it } from 'vitest'
import type { CameraPose } from './mount.js'
import { renderSky, renderSkyAsync } from './sky.js'
import { writeFits } from './fits.js'

const pose: CameraPose = { direction: [1, 0, 0], right: [0, 1, 0], up: [0, 0, 1] }
const options = { width: 101, height: 101, fieldHeightDegrees: 10, seed: 42 }

function brightest(image: Uint16Array) {
  let maximum = 0
  for (let index = 1; index < image.length; index++) if (image[index]! > image[maximum]!) maximum = index
  return [maximum % options.width, Math.floor(maximum / options.width)]
}

it('projects catalog stars through the camera basis and excludes stars behind it', () => {
  const star = { raDegrees: 0, decDegrees: 0, magnitude: 9 }
  expect(brightest(renderSky([star], pose, options))).toEqual([50, 50])
  expect(brightest(renderSky([{ ...star, raDegrees: 2 }], pose, options))).toEqual([70, 50])
  expect(brightest(renderSky([{ ...star, decDegrees: 2 }], pose, options))).toEqual([50, 30])
  expect(renderSky([{ ...star, raDegrees: 180 }], pose, options)).toEqual(renderSky([], pose, options))
})

it('produces reproducible noise and an obscured frame without stars', () => {
  const stars = [{ raDegrees: 0, decDegrees: 0, magnitude: -1 }]
  const clear = renderSky(stars, pose, options)
  expect(clear).toEqual(renderSky(stars, pose, options))
  expect(clear[50 * options.width + 50]).toBe(32767)
  expect(renderSky(stars, pose, { ...options, obscured: true })).toEqual(renderSky([], pose, options))
  expect(renderSky([], pose, { ...options, seed: 43 })).not.toEqual(renderSky([], pose, options))
})

it('writes padded signed big-endian FITS pixels without pointing hints', () => {
  const image = writeFits(2, 2, Uint16Array.from([1, 256, 32767, 0]))
  expect(image.length).toBe(5760)
  expect(image.subarray(0, 80).toString('ascii')).toContain('SIMPLE  =                    T')
  expect(image.subarray(0, 2880).toString('ascii')).not.toMatch(/CRVAL|CTYPE|OBJCTRA/)
  expect([...image.subarray(2880, 2888)]).toEqual([0, 1, 1, 0, 127, 255, 0, 0])
  expect(image[2888]).toBe(0)
  expect(() => writeFits(3, 2, new Uint16Array(4))).toThrow('dimensions')
  expect(() => writeFits(1, 1, Uint16Array.of(32768))).toThrow('signed 16-bit')
})


it('samples synthetic warm starlight in RGGB phase at the full sensor origin', () => {
  // This coordinate is deliberately assigned R:G:B = 1.6:0.8:0.4.
  // A half-pixel optical center puts all four center samples at equal radius,
  // making the expected channel ratios independent of the Gaussian profile.
  const colorOptions = { ...options, width: 100, height: 100, sensor: 'rggb' as const }
  const star = { raDegrees: 0, decDegrees: 0, magnitude: 10 }
  const image = renderSky([star], pose, colorOptions)
  const background = renderSky([], pose, colorOptions)
  const signal = (x: number, y: number) => image[y * 100 + x]! - background[y * 100 + x]!
  // Center square spans odd (49) and even (50) positions: B G / G R.
  expect(signal(50, 50) / signal(49, 49)).toBeCloseTo(4, 2)
  expect(signal(50, 49) / signal(49, 49)).toBeCloseTo(2, 2)
  expect(signal(49, 50)).toBeCloseTo(signal(50, 49), 0)
  expect(image).toEqual(renderSky([star], pose, colorOptions))
})

it('scales star signal with exposure and saturates at each sensor limit', () => {
  const star = { raDegrees: 0, decDegrees: 0, magnitude: 10 }
  for (const sensor of ['monochrome', 'rggb'] as const) {
    const signalAt = (exposureSeconds: number) => {
      const settings = { ...options, sensor, exposureSeconds }
      const image = renderSky([star], pose, settings)
      const background = renderSky([], pose, settings)
      return image[5100]! - background[5100]!
    }
    expect(signalAt(4) / signalAt(2)).toBeCloseTo(2, 2)
    expect(signalAt(0)).toBe(0)
    expect(renderSky([star], pose, { ...options, sensor, exposureSeconds: 1000 })[5100])
      .toBe(sensor === 'rggb' ? 65535 : 32767)
  }
  expect(renderSky([star], pose, options)).toEqual(renderSky([star], pose, { ...options, exposureSeconds: 2 }))
})

it('produces identical sync and async pixels across stripe boundaries', async () => {
  const stars = [
    { raDegrees: 0, decDegrees: 0, magnitude: 8 },
    { raDegrees: 1, decDegrees: -0.35, magnitude: 9 },
  ]
  for (const sensor of ['monochrome', 'rggb'] as const) {
    const settings = { ...options, width: 600, height: 600, sensor, exposureSeconds: 3 }
    expect(await renderSkyAsync(stars, pose, settings)).toEqual(renderSky(stars, pose, settings))
  }
})

it('yields while generating FRA-size pixels and allows cancellation', async () => {
  const settings = { ...options, width: 6248, height: 4176, sensor: 'rggb' as const }
  const controller = new AbortController()
  let heartbeat = false
  const generation = renderSkyAsync([], pose, settings, controller.signal)
  const stopped = expect(generation).rejects.toMatchObject({ name: 'AbortError' })
  setImmediate(() => {
    heartbeat = true
    controller.abort()
  })
  await stopped
  expect(heartbeat).toBe(true)
  await expect(renderSkyAsync([], pose, settings, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('generates the full FRA frame without the previous area cap', async () => {
  const pixels = await renderSkyAsync([], pose, { ...options, width: 6248, height: 4176, sensor: 'rggb' })
  expect(pixels.length).toBe(26091648)
  expect(pixels[0]).toBeGreaterThanOrEqual(494)
  expect(pixels[pixels.length - 1]).toBeLessThanOrEqual(506)
  expect(() => renderSky([], pose, { ...options, width: 6248, height: 4177 })).toThrow('dimensions')
  expect(() => renderSky([], pose, { ...options, exposureSeconds: Number.NaN })).toThrow('exposure')
})
