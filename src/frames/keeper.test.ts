import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeSpool } from '../testing/spool.ts'
import type { KeptFrame } from './entry.ts'
import { makeKeeper, type Sidecar } from './keeper.ts'

const spoolDir = '/spool'
const naming = { zone: 'America/Phoenix', changesAtHour: 12 }
const keptAtMs = Date.UTC(2026, 10, 8, 4, 0, 0)
const frameTime = Date.UTC(2026, 10, 8, 3, 30, 0)

let keepDir = ''

beforeEach(async () => {
  keepDir = await mkdtemp(join(tmpdir(), 'vela-keeper-'))
})

afterEach(async () => {
  await rm(keepDir, { recursive: true, force: true })
})

function setup(overrides: { attempts?: number; labels?: Record<string, { run: string; sequence: string; frame: number }> } = {}) {
  const spool = fakeSpool(spoolDir)
  const kept: KeptFrame[] = []
  const problems: string[] = []
  const sleeps: number[] = []

  const keeper = makeKeeper({
    ssh: spool.ssh,
    settings: { spoolDir, keepDir, naming, copyAttempts: overrides.attempts ?? 3, copyRetryMs: 5000 },
    labelOf: file => overrides.labels?.[file],
    now: () => keptAtMs,
    sleep: async ms => void sleeps.push(ms),
    onKept: frame => void kept.push(frame),
    onProblem: message => void problems.push(message),
  })

  return { spool, keeper, kept, problems, sleeps }
}

const content = (text: string) => Buffer.from(text.repeat(1000))

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('keeper', () => {
  it('copies a spooled frame to the night folder, checks it, and writes its sidecar', async () => {
    const { spool, keeper, kept, problems } = setup()
    const bytes = content('frame one ')

    spool.files.set('test_001.fits', { content: bytes, modifiedAt: frameTime })
    await keeper.requestScan()

    expect(problems).toEqual([])
    expect(kept).toEqual([{ file: 'test_001.fits', night: '2026-11-07', bytes: bytes.length, sha256: sha(bytes) }])
    expect(await readFile(join(keepDir, '2026-11-07', 'test_001.fits'))).toEqual(bytes)
    expect(JSON.parse(await readFile(join(keepDir, '2026-11-07', 'test_001.fits.json'), 'utf8'))).toEqual({
      run: null,
      sequence: null,
      frame: null,
      original: '/spool/test_001.fits',
      sha256: sha(bytes),
      bytes: bytes.length,
      keptAt: new Date(keptAtMs).toISOString(),
    } satisfies Sidecar)
    expect(spool.commands.map(command => command.split(' ')[0])).toEqual(['find', 'cat', 'sha256sum', 'rm'])
    expect(spool.files.has('test_001.fits')).toBe(false)
  })

  it('writes the run, sequence and frame number into the sidecar when the capture labelled the file', async () => {
    const { spool, keeper } = setup({ labels: { 'test_001.fits': { run: 'run-1', sequence: 'M-31_light', frame: 4 } } })

    spool.files.set('test_001.fits', { content: content('labelled'), modifiedAt: frameTime })
    spool.files.set('test_002.fits', { content: content('unlabelled'), modifiedAt: frameTime + 1000 })
    await keeper.requestScan()

    const sidecar = async (file: string) => JSON.parse(await readFile(join(keepDir, '2026-11-07', `${file}.json`), 'utf8')) as Sidecar

    expect(await sidecar('test_001.fits')).toMatchObject({ run: 'run-1', sequence: 'M-31_light', frame: 4 })
    expect(await sidecar('test_002.fits')).toMatchObject({ run: null, sequence: null, frame: null })
  })

  it('copies to a temporary name and renames it, so the frame name never holds a partial file', async () => {
    const { spool, keeper } = setup()
    const seen: string[][] = []

    spool.files.set('test_001.fits', { content: content('x'), modifiedAt: frameTime })
    spool.onCopy = () => void seen.push(readdirSync(join(keepDir, '2026-11-07')))
    await keeper.requestScan()

    expect(seen[0]?.includes('test_001.fits')).toBeFalsy()
    expect(await readdir(join(keepDir, '2026-11-07'))).toEqual(['test_001.fits', 'test_001.fits.json'])
  })

  it('retries a copy whose hash differs, and counts the frame once the retry checks out', async () => {
    const { spool, keeper, kept, problems, sleeps } = setup()

    spool.files.set('test_001.fits', { content: content('x'), modifiedAt: frameTime })
    spool.corruptNextCopies = 1
    await keeper.requestScan()

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('differs')
    expect(sleeps).toEqual([5000])
    expect(kept).toHaveLength(1)
  })

  it('does not count a frame whose copies all fail, leaves nothing under its name, and copies it on the next scan', async () => {
    const { spool, keeper, kept, problems } = setup({ attempts: 2 })

    spool.files.set('test_001.fits', { content: content('x'), modifiedAt: frameTime })
    spool.failNextCopies = 2
    await keeper.requestScan()

    expect(kept).toEqual([])
    expect(problems).toHaveLength(2)
    expect(existsSync(join(keepDir, '2026-11-07', 'test_001.fits'))).toBe(false)
    expect(existsSync(join(keepDir, '2026-11-07', 'test_001.fits.json'))).toBe(false)

    await keeper.requestScan()

    expect(kept).toHaveLength(1)
  })

  it('catches up: copies only the spooled files that are not yet kept', async () => {
    const { spool, keeper, kept } = setup()

    spool.files.set('test_001.fits', { content: content('one'), modifiedAt: frameTime })
    spool.files.set('test_002.fits', { content: content('two'), modifiedAt: frameTime + 60_000 })
    await keeper.requestScan()
    spool.files.set('test_003.fits', { content: content('three'), modifiedAt: frameTime + 120_000 })
    spool.commands.length = 0
    await keeper.requestScan()

    expect(kept.map(frame => frame.file)).toEqual(['test_001.fits', 'test_002.fits', 'test_003.fits'])
    const copies = spool.commands.filter(command => command.startsWith('cat '))

    expect(copies).toHaveLength(1)
    expect(copies[0]).toContain('test_003.fits')
  })

  it('names the night folder for the evening the frame was saved, by the spool file time', async () => {
    const { spool, keeper, kept } = setup()

    spool.files.set('a_001.fits', { content: content('a'), modifiedAt: Date.UTC(2026, 10, 8, 3, 0) })
    spool.files.set('a_002.fits', { content: content('b'), modifiedAt: Date.UTC(2026, 10, 9, 3, 0) })
    await keeper.requestScan()

    expect(kept.map(frame => frame.night)).toEqual(['2026-11-07', '2026-11-08'])
  })

  it('refuses to overwrite a kept frame with a different file of the same name', async () => {
    const { spool, keeper, kept, problems } = setup()

    await mkdir(join(keepDir, '2026-11-07'), { recursive: true })
    await writeFile(join(keepDir, '2026-11-07', 'test_001.fits'), 'old')
    await writeFile(join(keepDir, '2026-11-07', 'test_001.fits.json'), JSON.stringify({ bytes: 3 }))
    spool.files.set('test_001.fits', { content: content('new'), modifiedAt: frameTime })
    await keeper.requestScan()

    expect(kept).toEqual([])
    expect(problems[0]).toContain('not copied')
    expect(await readFile(join(keepDir, '2026-11-07', 'test_001.fits'), 'utf8')).toBe('old')
  })

  it('skips a spool entry whose name is not a plain frame name', async () => {
    const { spool, keeper, kept, problems } = setup()

    spool.files.set("odd name; rm -rf '.fits", { content: content('x'), modifiedAt: frameTime })
    await keeper.requestScan()

    expect(kept).toEqual([])
    expect(problems[0]).toContain('unusable')
    expect(spool.commands).toHaveLength(1)
  })

  it('reports a spool it cannot list and does not stop', async () => {
    const { problems } = setup()
    const failing = makeKeeper({
      ssh: async () => ({ code: 255, stdout: '', stderr: 'no route' }),
      settings: { spoolDir, keepDir, naming, copyAttempts: 1, copyRetryMs: 0 },
      labelOf: () => undefined,
      now: () => keptAtMs,
      sleep: async () => {},
      onKept: () => {},
      onProblem: message => void problems.push(message),
    })

    await failing.requestScan()

    expect(problems[0]).toContain('could not list')
  })

  it('folds scans asked for while one runs into one more scan', async () => {
    const { spool, keeper } = setup()

    await Promise.all([keeper.requestScan(), keeper.requestScan(), keeper.requestScan()])

    expect(spool.commands.filter(command => command.startsWith('find '))).toHaveLength(2)
  })
  it('removes an original that was kept earlier once its hash matches the kept frame, without copying it again', async () => {
    const { spool, keeper, kept, problems } = setup()
    const bytes = content('kept before ')

    spool.files.set('test_001.fits', { content: bytes, modifiedAt: frameTime })
    spool.failNextRemoves = 1
    await keeper.requestScan()

    expect(kept.map(frame => frame.file)).toEqual(['test_001.fits'])
    expect(spool.files.has('test_001.fits')).toBe(true)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('could not remove')

    spool.commands.length = 0
    await keeper.requestScan()

    expect(spool.commands.map(command => command.split(' ')[0])).toEqual(['find', 'sha256sum', 'rm'])
    expect(spool.files.has('test_001.fits')).toBe(false)
    expect(kept).toHaveLength(1)
  })

  it('leaves a spool file in place when its hash differs from the kept frame of that name', async () => {
    const { spool, keeper, problems } = setup()

    spool.files.set('test_001.fits', { content: content('aaaa'), modifiedAt: frameTime })
    spool.failNextRemoves = 1
    await keeper.requestScan()
    spool.files.set('test_001.fits', { content: content('bbbb'), modifiedAt: frameTime })
    problems.length = 0
    await keeper.requestScan()

    expect(spool.files.has('test_001.fits')).toBe(true)
    expect(problems).toEqual(['test_001.fits on the rig computer does not hash to the kept frame of that name: left in place'])
    expect(spool.commands.filter(command => command.startsWith('rm ')).length).toBe(1)
  })
})
