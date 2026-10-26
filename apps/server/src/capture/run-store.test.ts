import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  openFileCaptureRunStore,
  remainingFrames,
  resumeRequest,
  type CaptureRunRecord,
} from './run-store.js'

const record = (overrides: Partial<CaptureRunRecord> = {}): CaptureRunRecord => ({
  version: 1,
  rigId: 'fra-400',
  runId: 'run-1',
  startedAt: '2026-10-25T03:00:00.000Z',
  exposureSeconds: 120,
  repeat: true,
  frameCount: 30,
  frameType: 'light',
  saveFrames: true,
  subject: { targetId: 'm31', name: 'Andromeda Galaxy', catalog: 'M 31' },
  completedCount: 12,
  savedCount: 12,
  integrationSeconds: 1440,
  ...overrides,
})

const directories: string[] = []

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'vela-capture-runs-test-'))

  directories.push(path)

  return join(path, 'capture-runs.json')
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it('keeps a saved record for the next process to find, and forgets a cleared one', async () => {
  const path = await temporary()
  const store = await openFileCaptureRunStore(path)

  store.save(record())
  store.save(record({ completedCount: 13 }))
  await store.close()

  const next = await openFileCaptureRunStore(path)

  expect(next.unfinished('fra-400')).toEqual(record({ completedCount: 13 }))

  next.clear('fra-400')
  await next.close()

  expect((await openFileCaptureRunStore(path)).unfinished('fra-400')).toBeUndefined()
})

it('starts clean when the file is missing', async () => {
  const onError = vi.fn()

  expect((await openFileCaptureRunStore(await temporary(), { onError })).unfinished('fra-400')).toBeUndefined()
  expect(onError).not.toHaveBeenCalled()
})

it.each([
  ['not JSON', '{"runs": '],
  ['the wrong shape', '{"runs": []}'],
  ['an unknown field', '{"runs": {}, "extra": 1}'],
])('starts clean, and says so, when the file is %s', async (_, contents) => {
  const path = await temporary()
  const onError = vi.fn()

  await writeFile(path, contents)

  expect((await openFileCaptureRunStore(path, { onError })).unfinished('fra-400')).toBeUndefined()
  expect(onError).toHaveBeenCalledOnce()
})

it('drops one unreadable record and keeps the rest', async () => {
  const path = await temporary()
  const onError = vi.fn()

  await writeFile(
    path,
    JSON.stringify({ runs: { 'fra-400': record(), broken: { ...record({ rigId: 'broken' }), frameType: 'sparkle' }, 'other': record() } }),
  )

  const store = await openFileCaptureRunStore(path, { onError })

  expect(store.unfinished('fra-400')).toEqual(record())
  expect(store.unfinished('broken')).toBeUndefined()
  expect(store.unfinished('other')).toBeUndefined()
  expect(onError).toHaveBeenCalledTimes(2)
})

it('never raises a failed write to the capture, and still answers from memory', async () => {
  const blocked = await temporary()
  const onError = vi.fn()

  await writeFile(blocked, '')
  const store = await openFileCaptureRunStore(join(blocked, 'capture-runs.json'), { onError })

  onError.mockClear()
  expect(() => store.save(record())).not.toThrow()
  await store.close()
  expect(onError).toHaveBeenCalledOnce()
  expect(store.unfinished('fra-400')).toEqual(record())
})

it('writes the whole file with owner-only permissions and leaves no temporary file', async () => {
  const path = await temporary()
  const store = await openFileCaptureRunStore(path)

  store.save(record())
  await store.close()

  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ runs: { 'fra-400': record() } })
  expect(await readdir(join(path, '..'))).toEqual(['capture-runs.json'])
})

it('says how many frames a resumed run takes, and resumes with that count and the same settings', () => {
  expect(remainingFrames(record())).toBe(18)
  expect(resumeRequest(record())).toEqual({
    exposureSeconds: 120,
    repeat: true,
    frameCount: 18,
    saveFrames: true,
    frameType: 'light',
    subject: { targetId: 'm31', name: 'Andromeda Galaxy', catalog: 'M 31' },
  })
})

it('resumes a run that had no count as another run with no count', () => {
  const request = resumeRequest(record({ frameCount: null, completedCount: 400 }))

  expect(remainingFrames(record({ frameCount: null }))).toBeNull()
  expect(request).toMatchObject({ repeat: true })
  expect(request).not.toHaveProperty('frameCount')
})

it('resumes a single exposure that never finished, and nothing that did', () => {
  expect(resumeRequest(record({ repeat: false, frameCount: null, completedCount: 0 }))).toMatchObject({ repeat: false })
  expect(resumeRequest(record({ repeat: false, frameCount: null, completedCount: 1 }))).toBeUndefined()
})

it('has nothing to resume once every frame was taken, and keeps a calibration frame type', () => {
  expect(remainingFrames(record({ completedCount: 30 }))).toBe(0)
  expect(resumeRequest(record({ completedCount: 30 }))).toBeUndefined()
  expect(resumeRequest(record({ frameType: 'dark', subject: null }))).toMatchObject({ frameType: 'dark', subject: null })
})
