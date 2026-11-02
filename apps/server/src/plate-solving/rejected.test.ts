import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, truncate, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { readFits, readFitsCards } from '@vela/rig-astap'
import { decodeLine, type RigEvent } from '@vela/rig-events'
import { createAlignmentDiagnostics } from '../alignment/diagnostics.js'
import { createFramingController } from '../targets/framing.js'
import { openRunLog } from '../run-log/run-log.js'
import { astapReturning, falseSolve, fieldHeightDegreesFor } from './false-solve.js'
import { judgedSolver } from './judged-solver.js'
import { createFramingRejections, createRejectedStore, rejectedByteLimit, rejectedFrameLimit } from './rejected.js'

const roots: string[] = []

const frame = { width: 2, height: 2, pixels: new Float64Array([0, 65535, 3, 4]), color: { kind: 'mono' as const }, capturedAt: '2026-09-07T04:00:00Z' }

const claimed = { raDegrees: 10, decDegrees: 60 }

const metadata = { exposureSeconds: 2, cameraName: 'Synthetic camera' }

const solver = judgedSolver(astapReturning(falseSolve(claimed, frame)), fieldHeightDegreesFor(frame.height), 'framing')

async function root() {
  const directory = await mkdtemp(join(tmpdir(), 'vela-rejected-'))
  roots.push(directory)

  return directory
}

afterEach(async () => { await Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

async function rejection() {
  const verdict = await solver.solve(frame, claimed, claimed, new AbortController().signal)

  if (verdict.status !== 'no-solution') throw new Error('Expected false solve rejection')

  return { frame, metadata, verdict, claimed, rigId: 'synthetic', requestId: 'request' }
}

async function events(directory: string) {
  const lines = await readFile(join(directory, (await readdir(directory))[0]!), 'utf8')

  return lines.trim().split('\n').map(line => {
    const decoded = decodeLine(line)

    if (!decoded.ok) throw new Error('Invalid event')

    return decoded.event
  })
}

function verifyFits(bytes: Buffer, sha256: string) {
  const read = readFits(bytes)
  expect(read.ok).toBe(true)

  if (!read.ok) throw new Error(read.reason)
  expect(Array.from(read.frame.pixels)).toEqual(Array.from(frame.pixels))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
}

it('framing keeps the false solve pixels before the verdict and reads FITS cards and hash back from disk', async () => {
  const directory = await root()
  const logDirectory = join(directory, 'log')
  const log = openRunLog({ directory: logDirectory })
  const store = createRejectedStore(join(directory, 'rejected'))
  let originalAtAppend: Buffer | undefined

  const record = createFramingRejections(store, { append(event) {
    if (event.kind !== 'frame' || !event.body.image?.ref) throw new Error('Missing pixels')
    originalAtAppend = readFileSync(fileURLToPath(event.body.image.ref.uri))
    log.append(event)
  } })

  const mount = { rightAscensionDegrees: 10, declinationDegrees: 60, coordinateSystem: 'j2000', tracking: true, slewing: false, parked: false, observedAt: frame.capturedAt, latitudeDegrees: 30, longitudeDegrees: 0, pierSide: 'east' as const }

  const controller = createFramingController(() => new Date(frame.capturedAt), async () => {}, {
    render: async () => { throw new Error('No display') }, analyze: async () => { throw new Error('No analysis') },
  }, record)

  controller.start({ desired: claimed, targetId: 'synthetic', rigId: 'synthetic', cameraName: metadata.cameraName, exposureSeconds: 2, configuration: 'synthetic', action: 'check', requestId: 'request' }, {
    status: async () => mount, tracking: async () => {}, slew: async () => {}, capture: async () => frame,
  }, solver, () => {})
  await vi.waitFor(() => expect(controller.snapshot().active).toBe(false))
  await log.close()
  const [event] = await events(logDirectory)

  if (event?.kind !== 'frame' || !event.body.image?.ref) throw new Error('Missing frame event')
  const bytes = await readFile(fileURLToPath(event.body.image.ref.uri))
  verifyFits(bytes, event.body.image.ref.sha256!)
  expect(originalAtAppend).toEqual(bytes)
  expect(JSON.parse(event.body.message!)).toMatchObject({ reasons: ['scale', 'parity', 'off-hint'], measured: { arcsecPerPixel: expect.closeTo(2.3162), parity: -1 }, offHintDegrees: expect.closeTo(100.9), claimed, pixels: 'kept' })
  expect(readFitsCards(bytes).get('PIERSIDE')).toBe('EAST')

  for (const card of ['SITELAT', 'SITELONG', 'LST', 'HA', 'RA', 'DEC']) expect(readFitsCards(bytes).has(card)).toBe(true)
})

it('records missing pixels on FITS failure and leaves FITS intact on log failure', async () => {
  const directory = await root()
  const blocked = join(directory, 'blocked')
  await writeFile(blocked, 'not a directory')
  const recorded: RigEvent[] = []
  await createFramingRejections(createRejectedStore(blocked), { append: event => { recorded.push(event) } })(await rejection())
  const [event] = recorded
  expect(event?.kind === 'frame' && JSON.parse(event.body.message!).pixels).toBe('missing')
  const storeDirectory = join(directory, 'rejected')
  await expect(createFramingRejections(createRejectedStore(storeDirectory), { append() { throw new Error('log failed') } })(await rejection())).rejects.toThrow('log failed')
  expect(await readdir(storeDirectory)).toHaveLength(1)
})

it('keeps the newest 200 and trims the byte bound without touching sibling stores', async () => {
  const directory = await root()
  const rejected = join(directory, 'rejected')
  const store = createRejectedStore(rejected)
  const first = await store.write(frame, metadata)
  await utimes(first.path, 0, 0)
  const sibling = join(directory, 'saved.fits')
  await writeFile(sibling, 'keep')

  for (let i = 1; i <= rejectedFrameLimit; i++) await store.write(frame, metadata)
  expect(await readdir(rejected)).toHaveLength(200)
  await expect(readFile(first.path)).rejects.toThrow('ENOENT')
  const oldest = join(rejected, (await readdir(rejected))[0]!)
  await truncate(oldest, rejectedByteLimit)
  await utimes(oldest, 0, 0)
  await store.write(frame, metadata)
  await expect(readFile(oldest)).rejects.toThrow('ENOENT')
  const sizes = await Promise.all((await readdir(rejected)).map(async file => (await stat(join(rejected, file))).size))
  expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(rejectedByteLimit)
  expect(await readFile(sibling, 'utf8')).toBe('keep')
})

it.each([false, true])('alignment writes rejected FITS first and keeps the verdict if pixels fail (%s)', async failPixels => {
  const directory = await root()
  const logDirectory = join(directory, 'log')
  const log = openRunLog({ directory: logDirectory })
  const trials = join(directory, 'trials')
  const onError = vi.fn()
  const requireTrialFolder: string[] = []

  const run = await createAlignmentDiagnostics(trials, { append(event) {
    if (event.kind === 'alignment' && event.body.type === 'dropped' && !failPixels) {
      const detail = JSON.parse(event.body.detail!)
      const [folder] = requireTrialFolder
      verifyFits(readFileSync(join(trials, folder!, detail.original.filename)), detail.original.sha256)
    }

    log.append(event)
  } }, onError)({ runId: randomUUID(), rigId: 'synthetic', rigName: 'Synthetic rig', cameraId: 'camera', telescopeId: 'mount', ...metadata, mode: 'offline', simulator: { latitudeDegrees: 30, siderealTimeDegrees: 0, at: frame.capturedAt } })

  requireTrialFolder.push(...await readdir(trials))
  const folder = join(trials, requireTrialFolder[0]!)

  if (failPixels) { await rm(folder, { recursive: true }); await writeFile(folder, 'blocked') }

  await run!.recordRejected(frame, 1, (await rejection()).verdict, claimed)
  await log.close()
  const event = (await events(logDirectory))[1]

  if (event?.kind !== 'alignment' || event.body.type !== 'dropped') throw new Error('Missing verdict')
  const detail = JSON.parse(event.body.detail!)
  expect(detail.reasons).toEqual(['scale', 'parity', 'off-hint'])
  expect(event.body.detail!.length).toBeLessThanOrEqual(500)

  if (failPixels) expect(detail.pixels).toBe('missing')
  else verifyFits(await readFile(join(folder, detail.original.filename)), detail.original.sha256)
})

it('leaves alignment rejected FITS when the dropped event cannot be appended', async () => {
  const trials = join(await root(), 'trials')
  const onError = vi.fn()

  const run = await createAlignmentDiagnostics(trials, { append(event) {
    if (event.kind === 'alignment' && event.body.type === 'dropped') throw new Error('log failed')
  } }, onError)({ runId: randomUUID(), rigId: 'synthetic', rigName: 'Synthetic rig', cameraId: 'camera', telescopeId: 'mount', ...metadata, mode: 'offline', simulator: { latitudeDegrees: 30, siderealTimeDegrees: 0, at: frame.capturedAt } })

  await run!.recordRejected(frame, 1, (await rejection()).verdict, claimed)
  const folder = join(trials, (await readdir(trials))[0]!)
  const bytes = await readFile(join(folder, (await readdir(folder))[0]!))
  expect(readFits(bytes).ok).toBe(true)
  expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'log failed' }))
})
