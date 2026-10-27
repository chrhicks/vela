import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createObservationStore, observationsFilePath, type NewObservation } from './horizon-observations.js'
import { createHorizon, horizonFilePath, writeHorizonProfile } from './horizon.js'
import { syntheticProfile } from './horizon.fixture.js'

const directories: string[] = []

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'vela-horizon-observations-'))
  directories.push(path)

  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const observation = (overrides: Partial<NewObservation> = {}): NewObservation => ({
  at: '2026-01-01T03:00:00.000Z',
  altitudeDegrees: 25,
  azimuthDegrees: 100,
  strongBefore: 40,
  strongAt: 2,
  runId: 'run-1',
  ...overrides,
})

describe('horizon observations file', () => {
  it('keeps the file name inside the data directory and next to, not in, the profile', () => {
    expect(observationsFilePath('/data', 'rig-1')).toBe('/data/horizon-observations-rig-1.json')
    expect(observationsFilePath('/data', '../rig')).toBeNull()
    expect(observationsFilePath('/data', 'a/b')).toBeNull()
    expect(observationsFilePath('/data', '')).toBeNull()
  })

  it('adds, lists in order and persists mode 600', async () => {
    const dir = await directory()
    const store = createObservationStore(dir)

    expect(await store.list('rig')).toEqual([])

    const first = await store.add('rig', observation())
    const second = await store.add('rig', observation({ runId: 'run-2' }))

    expect(first.id).not.toBe(second.id)
    expect(await store.list('rig')).toEqual([first, second])
    expect(await createObservationStore(dir).list('rig')).toEqual([first, second])
    expect((await stat(observationsFilePath(dir, 'rig')!)).mode & 0o777).toBe(0o600)
  })

  it('removes one observation and says so when there is none to remove', async () => {
    const store = createObservationStore(await directory())
    const first = await store.add('rig', observation())
    const second = await store.add('rig', observation({ runId: 'run-2' }))

    expect(await store.remove('rig', first.id)).toBe(true)
    expect(await store.list('rig')).toEqual([second])
    expect(await store.remove('rig', first.id)).toBe(false)
    expect(await store.remove('other', first.id)).toBe(false)
  })

  it('loses nothing when records and deletes overlap', async () => {
    const store = createObservationStore(await directory())
    const doomed = await store.add('rig', observation({ runId: 'doomed' }))

    const added = await Promise.all([
      store.remove('rig', doomed.id),
      ...Array.from({ length: 8 }, (_, index) => store.add('rig', observation({ runId: `run-${index}` }))),
    ])

    expect(added[0]).toBe(true)
    expect((await store.list('rig')).map(item => item.runId).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `run-${index}`).sort(),
    )
  })

  it('keeps one rig apart from another', async () => {
    const store = createObservationStore(await directory())
    const kept = await store.add('rig-a', observation())

    await store.add('rig-b', observation())
    expect(await store.list('rig-a')).toEqual([kept])
  })

  it('ignores an unusable file with one warning without values, and never overwrites it', async () => {
    const dir = await directory()
    const warn = vi.fn()
    const store = createObservationStore(dir, warn)
    const path = observationsFilePath(dir, 'rig')!

    await writeFile(path, '{"version":1,"observations":[{"altitudeDegrees":33.25')

    expect(await store.list('rig')).toEqual([])
    expect(await store.list('rig')).toEqual([])
    await expect(store.add('rig', observation())).rejects.toThrow()
    await expect(store.remove('rig', 'x')).rejects.toThrow()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/33\.25/)
    expect(await readFile(path, 'utf8')).toContain('33.25')

    await mkdir(observationsFilePath(dir, 'directory')!)
    expect(await store.list('directory')).toEqual([])
  })

  it('rejects an observation that is not a point in the sky', async () => {
    const store = createObservationStore(await directory())

    await expect(store.add('rig', observation({ altitudeDegrees: 95 }))).rejects.toThrow()
    await expect(store.add('rig', observation({ azimuthDegrees: 360 }))).rejects.toThrow()
    await expect(store.add('rig', observation({ strongAt: -1 }))).rejects.toThrow()
    expect(await store.list('rig')).toEqual([])
  })
})

describe('horizon problem', () => {
  it('is none for missing files and for readable ones', async () => {
    const dir = await directory()
    const horizon = createHorizon(dir)

    expect((await horizon.view('rig')).problem).toBeNull()
    await writeHorizonProfile(horizonFilePath(dir, 'rig')!, syntheticProfile())
    await horizon.observations.add('rig', observation())
    expect((await horizon.view('rig')).problem).toBeNull()
  })

  it('says unreadable for an unusable profile or observations file, without losing the other', async () => {
    const dir = await directory()
    const horizon = createHorizon(dir)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await writeFile(horizonFilePath(dir, 'broken')!, '{"altitudesDegrees":[41.5')
    expect(await horizon.view('broken')).toEqual({ skyline: null, problem: 'unreadable' })

    await writeHorizonProfile(horizonFilePath(dir, 'rig')!, syntheticProfile())
    await writeFile(observationsFilePath(dir, 'rig')!, '{"observations":[33.25')

    const view = await horizon.view('rig')

    expect(view.problem).toBe('unreadable')
    expect(view.skyline!.bins[25]).toEqual({ kind: 'traced', altitudeDegrees: 5 })
    expect(JSON.stringify(view)).not.toMatch(/33\.25|41\.5/)
    warn.mockRestore()
  })
})

describe('horizon with observations', () => {
  it('folds observations into the profile on every call and never rewrites the profile', async () => {
    const dir = await directory()
    const horizon = createHorizon(dir)
    const profilePath = horizonFilePath(dir, 'rig')!

    expect(await horizon.skyline('rig')).toBeNull()
    await horizon.observations.add('rig', observation())
    expect(await horizon.skyline('rig')).toBeNull()

    await writeHorizonProfile(profilePath, syntheticProfile())
    const before = await readFile(profilePath, 'utf8')

    expect((await horizon.skyline('rig'))!.bins[25]).toEqual({ kind: 'observed', altitudeDegrees: 25 })

    const [added] = await horizon.observations.list('rig')

    await horizon.observations.remove('rig', added!.id)
    expect((await horizon.skyline('rig'))!.bins[25]).toEqual({ kind: 'traced', altitudeDegrees: 5 })
    expect(await readFile(profilePath, 'utf8')).toBe(before)
  })

  it('survives a re-import of the survey', async () => {
    const dir = await directory()
    const horizon = createHorizon(dir)
    const profilePath = horizonFilePath(dir, 'rig')!

    await writeHorizonProfile(profilePath, syntheticProfile())
    await horizon.observations.add('rig', observation())
    await writeHorizonProfile(profilePath, syntheticProfile({ note: 're-imported' }))

    expect((await horizon.skyline('rig'))!.bins[25]!.kind).toBe('observed')
  })
})
