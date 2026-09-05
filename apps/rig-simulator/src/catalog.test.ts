import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { decodeD05, loadCatalog } from './catalog.js'

function tile(raDegrees: number, decDegrees: number, magnitude: number) {
  const data = Buffer.alloc(120)
  data[109] = 5
  const decRaw = Math.round(decDegrees / 90 * 0x7fffff)
  data.writeUIntLE(0xffffff, 110, 3)
  data[113] = Math.floor(decRaw / 65536) + 128
  data[114] = Math.round(magnitude * 10 + 16)
  data.writeUIntLE(Math.round(raDegrees / 360 * 0xffffff), 115, 3)
  data.writeUInt16LE(decRaw & 0xffff, 118)
  return data
}

it('decodes signed declinations and magnitudes from five-byte D05 blocks', () => {
  const [star] = decodeD05(tile(23, -60, 12.3))
  expect(star!.raDegrees).toBeCloseTo(23, 4)
  expect(star!.decDegrees).toBeCloseTo(-60, 4)
  expect(star!.magnitude).toBe(12.3)
})

it('rejects unsupported record widths, partial records, missing block headers and invalid declination', () => {
  const valid = tile(23, 60, 12.3)
  const unsupported = Buffer.from(valid)
  unsupported[109] = 6
  expect(() => decodeD05(unsupported)).toThrow('five-byte')
  expect(() => decodeD05(valid.subarray(0, 119))).toThrow('truncated')
  const missingHeader = Buffer.concat([valid.subarray(0, 110), valid.subarray(115)])
  expect(() => decodeD05(missingHeader)).toThrow('before D05 block header')
  const invalidDec = Buffer.from(valid)
  invalidDec[113] = 0
  invalidDec.writeUInt16LE(0, 118)
  expect(() => decodeD05(invalidDec)).toThrow('declination outside')
})

it('loads only D05 tiles and applies the configured sky bounds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-d05-'))
  try {
    await writeFile(join(directory, 'd05_0001.1476'), tile(23, 60, 12.3))
    await writeFile(join(directory, 'd05_0002.1476'), tile(100, 60, 10))
    await writeFile(join(directory, 'other.1476'), 'not a catalog')
    const stars = await loadCatalog(directory)
    expect(stars).toHaveLength(1)
    expect(stars[0]!.raDegrees).toBeCloseTo(23, 4)
    await expect(loadCatalog(directory, { minRaDegrees: 200, maxRaDegrees: 210, minDecDegrees: 0, maxDecDegrees: 10 })).rejects.toThrow('no stars')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
