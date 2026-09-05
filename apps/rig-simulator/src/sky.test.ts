import { expect, it } from 'vitest'
import type { CameraPose } from './mount.js'
import { renderSky } from './sky.js'
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
