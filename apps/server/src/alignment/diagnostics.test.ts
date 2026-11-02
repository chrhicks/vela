import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlpacaFrame } from '@vela/alpaca'
import {
  createAlignmentDiagnostics,
  type AlignmentDiagnosticRunInfo,
  type AlignmentFrameEvidence,
} from './diagnostics.js'
import { openRunLog } from '../run-log/run-log.js'
import { loggedJournalEntries } from './alignment-events.js'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'vela-diagnostics-test-'))
  roots.push(root)

  return root
}

const info: AlignmentDiagnosticRunInfo = {
  runId: randomUUID(),
  rigId: 'rig',
  rigName: 'Offline rig',
  mode: 'offline',
  simulator: { latitudeDegrees: 33.45, siderealTimeDegrees: 0, at: '2026-09-20T03:00:00.123Z' },
  cameraId: 'camera',
  telescopeId: 'mount',
  cameraName: 'Camera',
  exposureSeconds: 2,
}

const capturedAt = '2026-09-20T03:00:00.123Z'

const frame: AlpacaFrame = {
  width: 2,
  height: 2,
  pixels: new Float64Array([0, 65535, -1, 2_147_483_647]),
  capturedAt,
  color: { kind: 'mono' },
}

const evidence: AlignmentFrameEvidence = {
  phase: 'baseline',
  position: 1,
  hint: { raDegrees: 10, decDegrees: 60 },
  fieldHeightDegrees: 3,
  sample: { raDegrees: 10, decDegrees: 60, siderealTimeDegrees: 0, capturedAt },
  solution: {
    status: 'solved',
    raDegrees: 10,
    decDegrees: 60,
    capturedAt,
    wcs: {
      width: 2,
      height: 2,
      referenceX: 1.5,
      referenceY: 1.5,
      raDegrees: 10,
      decDegrees: 60,
      cd: [-0.01, 0, 0, 0.01],
    },
  },
  offlinePointing: {
    rightAscensionDegrees: 10,
    declinationDegrees: 60,
    siderealTimeDegrees: 0,
    latitudeDegrees: 33.45,
    tracking: true,
    coordinateSystem: 'j2000',
  },
}

describe('alignment records on the shared run log', () => {
  it('keeps FITS in its named folder and emits site-free events with ordered ids', async () => {
    const root = await temporaryRoot()
    const log = openRunLog({ directory: join(root, 'log') })
    const onError = vi.fn()
    const run = (await createAlignmentDiagnostics(join(root, 'trials'), log, onError)(info))!
    await run.recordFrame(frame, evidence)
    await run.recordDropped(2, 'no-solve', null)
    await run.finish({ phase: 'stopped', error: null })
    await log.close()
    const [folder] = await readdir(join(root, 'trials'))
    expect(await readdir(join(root, 'trials', folder!))).toHaveLength(1)
    const entries = await loggedJournalEntries(join(root, 'log'), folder!)
    expect(entries?.map(entry => entry.type)).toEqual(['run', 'frame', 'dropped', 'outcome'])
    expect(await replayAlignmentDiagnostics(join(root, 'trials', folder!), join(root, 'log'))).toMatchObject({ outcome: { phase: 'stopped' }, counts: { frames: 1, verifiedOriginals: 1 } })
    const [file] = await readdir(join(root, 'log'))
    const events = (await readFile(join(root, 'log', file!), 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line))
    expect(events.map(event => event.id)).toEqual([1, 2, 3, 4].map(n => `alignment:${info.runId}:${n}`))
    expect(events[1].body.evidence.sample).not.toHaveProperty('siderealTimeDegrees')
    expect(events[1].body.evidence.offlinePointing).not.toHaveProperty('latitudeDegrees')
    expect(onError).not.toHaveBeenCalled()
  })

  it('tries again after an oversized FITS and contains even an error reporter failure', async () => {
    const root = await temporaryRoot()
    const log = openRunLog({ directory: join(root, 'log') })
    const onError = vi.fn(() => { throw new Error('Logger unavailable') })
    const run = (await createAlignmentDiagnostics(join(root, 'trials'), log, onError)(info))!
    await expect(run.recordFrame({ ...frame, width: 8192, height: 8192, pixels: new Float64Array(0) }, evidence)).resolves.toBeUndefined()
    await run.recordFrame(frame, evidence)
    await run.finish({ phase: 'stopped', error: null })
    await log.close()
    const [folder] = await readdir(join(root, 'trials'))
    expect(await readdir(join(root, 'trials', folder!))).toHaveLength(1)
    expect(onError).toHaveBeenCalledOnce()
    expect((await loggedJournalEntries(join(root, 'log'), folder!))?.map(entry => entry.type)).toEqual(['run', 'frame', 'outcome'])
  })

  it('ignores a parseable final event without its committing newline', async () => {
    const root = await temporaryRoot()
    const log = openRunLog({ directory: join(root, 'log') })
    const run = (await createAlignmentDiagnostics(join(root, 'trials'), log, () => {})(info))!
    await run.finish({ phase: 'stopped', error: null })
    await log.close()
    const [folder] = await readdir(join(root, 'trials'))
    const [file] = await readdir(join(root, 'log'))
    const path = join(root, 'log', file!)
    const { truncate, stat } = await import('node:fs/promises')
    await truncate(path, (await stat(path)).size - 1)
    expect((await loggedJournalEntries(path, folder!))?.map(entry => entry.type)).toEqual(['run'])
    expect(await replayAlignmentDiagnostics(join(root, 'trials', folder!), path)).toMatchObject({ outcome: { phase: 'incomplete' } })
  })

  it('reports invalid opt-in roots and unsafe run ids without rejecting into the caller', async () => {
    const onError = vi.fn()
    const log = { append() {} }
    expect(await createAlignmentDiagnostics('relative', log, onError)(info)).toBeUndefined()
    expect(await createAlignmentDiagnostics(await temporaryRoot(), log, onError)({ ...info, runId: '../outside' })).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
