import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHorizonStore,
  horizonFilePath,
  horizonInWindow,
  horizonStatus,
  parseHorizonProfile,
  writeHorizonProfile,
} from './horizon.js'
import { syntheticProfile } from './horizon.fixture.js'
import { skyPath } from './sky.js'

const directories: string[] = []

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'vela-horizon-'))
  directories.push(path)

  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('horizon status', () => {
  const profile = syntheticProfile()

  it('is behind a traced skyline, clear above it, and unknown over an untraced bin at any altitude', () => {
    expect(horizonStatus(profile, 2, 39)).toBe('behind')
    expect(horizonStatus(profile, 2, 40)).toBe('behind')
    expect(horizonStatus(profile, 2, 41)).toBe('clear')
    expect(horizonStatus(profile, 6, 1)).toBe('unknown')
    expect(horizonStatus(profile, 6, 89)).toBe('unknown')
    expect(horizonStatus(profile, 100, 6)).toBe('clear')
    expect(horizonStatus(profile, 100, 4)).toBe('behind')
  })

  it('wraps azimuth and takes the first bin at a bin edge', () => {
    expect(horizonStatus(profile, 360, 20)).toBe('behind')
    expect(horizonStatus(profile, -2, 20)).toBe('clear')
    expect(horizonStatus(profile, 4, 20)).toBe('unknown')
    expect(horizonStatus(profile, 359.999, 4)).toBe('behind')
  })

  it('says nothing without a profile instead of clear', () => {
    expect(horizonStatus(null, 2, 30)).toBeNull()
  })
})

describe('horizon profile file', () => {
  it('rejects anything that is not exactly 360 degrees of bins or leaves an altitude out of range', () => {
    expect(() => parseHorizonProfile(syntheticProfile())).not.toThrow()
    expect(() => parseHorizonProfile(syntheticProfile({ altitudesDegrees: [1, 2, 3] }))).toThrow()
    expect(() => parseHorizonProfile(syntheticProfile({ stepDegrees: 0 }))).toThrow()
    expect(() => parseHorizonProfile({ ...syntheticProfile(), extra: 1 })).toThrow()
    expect(() => parseHorizonProfile({ ...syntheticProfile(), approximate: false })).toThrow()

    expect(() =>
      parseHorizonProfile(
        syntheticProfile({ stepDegrees: 120, altitudesDegrees: [1, 95, 2] }),
      ),
    ).toThrow()

    expect(() =>
      parseHorizonProfile(syntheticProfile({ stepDegrees: 120, altitudesDegrees: [1, -1, 2] })),
    ).toThrow()
  })

  it('keeps the file name inside the data directory', () => {
    expect(horizonFilePath('/data', 'rig-1')).toBe('/data/horizon-rig-1.json')
    expect(horizonFilePath('/data', '../rig')).toBeNull()
    expect(horizonFilePath('/data', 'a/b')).toBeNull()
    expect(horizonFilePath('/data', '.hidden')).toBeNull()
    expect(horizonFilePath('/data', '')).toBeNull()
  })

  it('writes mode 600 and reads it back', async () => {
    const dir = await directory()
    const path = horizonFilePath(dir, 'rig')!

    await writeHorizonProfile(path, syntheticProfile())
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await createHorizonStore(dir).forRig('rig')).toEqual(syntheticProfile())
  })

  it('reads again on every call so an import applies without a restart', async () => {
    const dir = await directory()
    const store = createHorizonStore(dir)

    expect(await store.forRig('rig')).toBeNull()
    await writeHorizonProfile(horizonFilePath(dir, 'rig')!, syntheticProfile())
    expect(await store.forRig('rig')).not.toBeNull()
  })

  it('ignores a malformed or unreadable file with one warning that carries no values', async () => {
    const dir = await directory()
    const warn = vi.fn()
    const store = createHorizonStore(dir, warn)

    await writeFile(horizonFilePath(dir, 'broken')!, '{"altitudesDegrees":[41.5,null],"x":')
    await writeFile(horizonFilePath(dir, 'wrong')!, JSON.stringify({ altitudesDegrees: [41.5] }))
    await mkdir(horizonFilePath(dir, 'directory')!)

    expect(await store.forRig('broken')).toBeNull()
    expect(await store.forRig('broken')).toBeNull()
    expect(await store.forRig('wrong')).toBeNull()
    expect(await store.forRig('directory')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/41\.5/)
    expect(await readFile(horizonFilePath(dir, 'wrong')!, 'utf8')).toContain('41.5')
  })
})

describe('horizon over a window', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes)).toISOString()

  const samples = [
    'clear',
    'behind',
    'behind',
    'unknown',
    'clear',
  ].map((horizon, index) => ({ at: at(index * 15), horizon: horizon as 'clear' }))

  it('counts the 15-minute samples inside the window by status', () => {
    expect(horizonInWindow(samples, { startsAt: at(15), endsAt: at(45) })).toEqual({
      checkedMinutes: 45,
      behindMinutes: 30,
      unknownMinutes: 15,
    })
  })

  it('has nothing to say without a sample in the window or without a profile', () => {
    expect(horizonInWindow(samples, { startsAt: at(16), endsAt: at(29) })).toBeNull()
    expect(horizonInWindow(samples.map(s => ({ ...s, horizon: null })), { startsAt: at(0), endsAt: at(60) })).toBeNull()
  })
})

describe('sky path against a profile', () => {
  const site = { latitudeDegrees: 40, longitudeDegrees: -75, elevationMeters: 0 }
  const now = new Date('2026-09-07T04:00:00Z')
  const target = { raDegrees: 10.68470833, decDegrees: 41.26875 }

  it('marks every sample null without a profile and never changes the path or windows', () => {
    const plain = skyPath(target, site, now)
    const flat = skyPath(target, site, now, syntheticProfile({ stepDegrees: 360, altitudesDegrees: [89] }))

    expect(plain.samples.every(sample => sample.horizon === null)).toBe(true)
    expect(flat.aboveHorizonDuringDarkness).toEqual(plain.aboveHorizonDuringDarkness)

    expect(flat.samples.map(({ horizon: _h, ...rest }) => rest)).toEqual(
      plain.samples.map(({ horizon: _h, ...rest }) => rest),
    )
  })

  it('classifies each sample by its own azimuth and altitude', () => {
    const profile = syntheticProfile({ stepDegrees: 360, altitudesDegrees: [50] })
    const { samples } = skyPath(target, site, now, profile)

    for (const sample of samples)
      expect(sample.horizon).toBe(sample.altitudeDegrees <= 50 ? 'behind' : 'clear')

    expect(samples.some(sample => sample.horizon === 'behind')).toBe(true)
    expect(samples.some(sample => sample.horizon === 'clear')).toBe(true)
  })

  it('reports an all-untraced profile as unknown everywhere, never clear', () => {
    const { samples } = skyPath(target, site, now, syntheticProfile({ stepDegrees: 360, altitudesDegrees: [null] }))

    expect(samples.every(sample => sample.horizon === 'unknown')).toBe(true)
  })
})
