import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createStarSource, decodeD05, loadCatalog } from './catalog.js'

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

async function withCatalog(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'vela-d05-field-'))

  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

it('selects a spherical field across RA zero and both poles', async () => {
  await withCatalog(async directory => {
    const positions = [[359.8, 0], [0.2, 0], [0.4, 0.4], [180, 89.8], [90, 89.8], [180, -89.8], [90, -89.8]]
    await Promise.all(positions.map(([ra, dec], index) => writeFile(join(directory, `d05_${index}.1476`), tile(ra!, dec!, 10))))
    const source = createStarSource(directory)
    const equator = await source({ raDegrees: 0, decDegrees: 0, radiusDegrees: 0.5 })
    expect(equator.map(star => Math.round(star.raDegrees))).toEqual([360, 0])
    const north = await source({ raDegrees: 0, decDegrees: 90, radiusDegrees: 0.3 })
    expect(north).toHaveLength(2)
    expect(north.every(star => star.decDegrees > 89)).toBe(true)
    const south = await source({ raDegrees: 270, decDegrees: -90, radiusDegrees: 0.3 })
    expect(south).toHaveLength(2)
    expect(south.every(star => star.decDegrees < -89)).toBe(true)
  })
})

it('reuses a padded region for nearby fields but filters each requested cone', async () => {
  await withCatalog(async directory => {
    const path = join(directory, 'd05_1.1476')
    await writeFile(path, tile(0.8, 0, 10))
    const source = createStarSource(directory)
    expect(await source({ raDegrees: 0, decDegrees: 0, radiusDegrees: 0.2 })).toHaveLength(0)
    await rm(path)
    expect(await source({ raDegrees: 0.8, decDegrees: 0, radiusDegrees: 0.2 })).toHaveLength(1)
    await expect(source({ raDegrees: 10, decDegrees: 0, radiusDegrees: 0.2 })).rejects.toThrow('No ASTAP D05')
    // A failed cache miss must not discard the previous successful field.
    expect(await source({ raDegrees: 0.8, decDegrees: 0, radiusDegrees: 0.2 })).toHaveLength(1)
  })
})

it('cancels in-flight reads independently and leaves the source reusable', async () => {
  await withCatalog(async directory => {
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeFile(join(directory, `d05_${index}.1476`), tile(20, 0, 10))))
    const source = createStarSource(directory)
    const field = { raDegrees: 20, decDegrees: 0, radiusDegrees: 1 }
    const controller = new AbortController()
    const cancelled = source(field, controller.signal)
    const rejection = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const independent = source(field)
    await new Promise<void>(resolve => setImmediate(resolve))
    controller.abort()
    await rejection
    expect(await independent).toHaveLength(20)
    expect(await source(field)).toHaveLength(20)
    await expect(source(field, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

it('reports absent or malformed catalog data and retries after a failed load', async () => {
  await withCatalog(async directory => {
    const source = createStarSource(directory)
    const field = { raDegrees: 20, decDegrees: 0, radiusDegrees: 1 }
    await expect(source(field)).rejects.toThrow('No ASTAP D05')
    const path = join(directory, 'd05_1.1476')
    await writeFile(path, 'broken catalog')
    await expect(source(field)).rejects.toThrow('unsupported or truncated')
    await writeFile(path, tile(100, 0, 10))
    await expect(source(field)).rejects.toThrow('no stars around')
    await writeFile(path, tile(20, 0, 10))
    expect(await source(field)).toHaveLength(1)
  })
})

it('rejects malformed field coordinates before accessing the catalog', async () => {
  const source = createStarSource('/unused')
  const field = { raDegrees: 20, decDegrees: 0, radiusDegrees: 1 }

  for (const invalid of [
    { raDegrees: NaN }, { raDegrees: -1 }, { raDegrees: 360 },
    { decDegrees: 91 }, { decDegrees: -91 }, { decDegrees: Infinity },
    { radiusDegrees: 0 }, { radiusDegrees: -1 }, { radiusDegrees: 181 }, { radiusDegrees: NaN },
  ]) {
    await expect(source({ ...field, ...invalid })).rejects.toThrow('Catalog field requires')
  }
})
