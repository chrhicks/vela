import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlpacaFrame } from '@vela/alpaca'
import { createAlignmentDiagnostics, type AlignmentDiagnosticRunInfo, type AlignmentFrameEvidence } from './diagnostics.js'
import { diagnosticJournalName, maximumJournalBytes } from './diagnostic-schema.js'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample } from './geometry.js'

const roots: string[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

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
    latitudeDegrees: 40,
    tracking: true,
    coordinateSystem: 'j2000',
  },
}

describe('bounded alignment diagnostic recording', () => {
  it('replays an offline baseline and preserves a stopped attempt before any solved frame', async () => {
    const root = await temporaryRoot()
    const onError = vi.fn()
    const create = createAlignmentDiagnostics(root, onError)
    const run = (await create(info))!

    const samples: [AlignmentSample, AlignmentSample, AlignmentSample] = [
      { ...evidence.sample, raDegrees: 10 },
      { ...evidence.sample, raDegrees: 28 },
      { ...evidence.sample, raDegrees: 46 },
    ]

    for (const [index, sample] of samples.entries()) {
      await run.recordFrame(frame, {
        ...evidence,
        position: index + 1,
        sample,
        solution: {
          ...evidence.solution,
          raDegrees: sample.raDegrees,
          wcs: { ...evidence.solution.wcs, raDegrees: sample.raDegrees },
        },
      })
    }

    const baseline = createAlignmentBaseline(samples, 40)
    const measurement = measureAlignment(baseline, samples[2], true)
    await run.recordBaseline(samples, 40, baseline.measurement)
    await run.recordMeasurement(samples[2], measurement)
    await run.finish({ phase: 'finished', error: null })
    const firstDirectory = (await readdir(root))[0]!
    expect(await replayAlignmentDiagnostics(join(root, firstDirectory))).toMatchObject({
      mode: 'offline',
      baseline,
      finalMeasurement: measurement,
      outcome: { phase: 'finished' },
      counts: { frames: 3, measurements: 1, physicalFrames: 0, verifiedOriginals: 3 },
    })
    const earlyStop = (await create(info))!
    await earlyStop.finish({ phase: 'stopped', error: null })
    const secondDirectory = (await readdir(root)).find(name => name !== firstDirectory)!
    expect(await replayAlignmentDiagnostics(join(root, secondDirectory))).toMatchObject({
      outcome: { phase: 'stopped' },
      baseline: null,
      finalMeasurement: null,
      counts: { frames: 0, measurements: 0 },
    })
    expect(onError).not.toHaveBeenCalled()
  })

  it('creates isolated unique runs without removing or overwriting a previous trial', async () => {
    const root = await temporaryRoot()
    const onError = vi.fn()
    const create = createAlignmentDiagnostics(root, onError)
    const first = await create(info)
    await first!.recordFrame(frame, evidence)
    await first!.finish({ phase: 'stopped', error: null })
    const second = await create(info)
    await second!.finish({ phase: 'failed', error: 'Solver failed' })
    const directories = await readdir(root)
    expect(directories).toHaveLength(2)
    const journals = await Promise.all(directories.map(directory => readFile(join(root, directory, diagnosticJournalName), 'utf8')))
    expect(journals.some(journal => journal.includes('"phase":"stopped"'))).toBe(true)
    expect(journals.some(journal => journal.includes('"error":"Solver failed"'))).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('disables after a storage failure and contains even an error reporter failure', async () => {
    const root = await temporaryRoot()
    const onError = vi.fn(() => { throw new Error('Logger unavailable') })
    const run = await createAlignmentDiagnostics(root, onError)(info)
    const directory = join(root, (await readdir(root))[0]!)
    const journal = join(directory, diagnosticJournalName)
    await unlink(journal)
    await mkdir(journal)
    await expect(run!.recordFrame(frame, evidence)).resolves.toBeUndefined()
    const filesAfterFailure = await readdir(directory)
    await run!.recordFrame(frame, evidence)
    await run!.finish({ phase: 'finished', error: null })
    expect(await readdir(directory)).toEqual(filesAfterFailure)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('rejects oversized FITS before encoding pixels, and disables on the journal cap', async () => {
    const root = await temporaryRoot()
    const onError = vi.fn()
    const create = createAlignmentDiagnostics(root, onError)
    const run = await create(info)
    const directory = join(root, (await readdir(root))[0]!)
    await run!.recordFrame({ ...frame, width: 8192, height: 8192, pixels: new Float64Array(0) }, evidence)
    await run!.recordFrame(frame, evidence)
    expect(await readdir(directory)).toEqual([diagnosticJournalName])
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('128 MiB') }))

    const second = await create(info)
    await second!.finish({ phase: 'failed', error: 'x'.repeat(maximumJournalBytes) })
    await second!.finish({ phase: 'stopped', error: null })
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError.mock.calls[1]![0].message).toContain('4 MiB')
    const secondDirectory = (await readdir(root)).find(name => join(root, name) !== directory)!
    expect((await readFile(join(root, secondDirectory, diagnosticJournalName), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it('reports invalid opt-in roots and unsafe run IDs without rejecting into the caller', async () => {
    const onError = vi.fn()
    expect(await createAlignmentDiagnostics('relative', onError)(info)).toBeUndefined()
    expect(await createAlignmentDiagnostics(await temporaryRoot(), onError)({ ...info, runId: '../outside' })).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
