import { randomUUID } from 'node:crypto'
import { appendFile, mkdtemp, readFile, readdir, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AlpacaFrame, AlpacaTelescopeStatus } from '@vela/alpaca'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAlignmentDiagnostics, type AlignmentFrameEvidence } from './diagnostics.js'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'
import { diagnosticEntrySchema, diagnosticJournalName, maximumFitsBytes, maximumJournalBytes, type DiagnosticEntry } from './diagnostic-schema.js'
import { createAlignmentBaseline, measureAlignment } from './geometry.js'
import { physicalAlignmentSample } from './physical-coordinates.js'
import { fixture } from './physical-fixture.js'

const roots: string[] = []

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function physicalTrial(phase?: 'finished' | 'stopped' | 'failed') {
  const root = await mkdtemp(join(tmpdir(), 'vela-diagnostic-replay-test-'))
  roots.push(root)
  const onError = vi.fn()
  const runId = randomUUID()

  const run = (await createAlignmentDiagnostics(root, onError)({
    runId, rigId: 'physical', rigName: 'Fixture rig', mode: 'physical',
    cameraId: 'camera', telescopeId: 'mount', cameraName: 'Fixture camera', exposureSeconds: 2,
  }))!

  const reference = fixture.cases[1]!
  const samples = reference.samples.map(capture => physicalAlignmentSample(capture.solved, { capturedAt: capture.capturedAt, exposureSeconds: 2 }, fixture.site))
  const baseline = createAlignmentBaseline([samples[0]!, samples[1]!, samples[2]!], fixture.site.latitudeDegrees)

  const mount: AlpacaTelescopeStatus = {
    rightAscensionDegrees: 10, declinationDegrees: 60, coordinateSystem: 'topocentric', ...fixture.site,
    tracking: true, trackingRate: 'sidereal', rightAscensionRateSecondsPerSiderealSecond: 0,
    declinationRateArcsecondsPerSecond: 0, pierSide: 'east', parked: false, slewing: false,
    observedAt: reference.samples[0].capturedAt,
  }

  let frameSerial = 0

  async function capture(input: typeof reference.adjusted, phase: 'baseline' | 'adjusting', position: number) {
    frameSerial++

    const frame: AlpacaFrame = {
      width: 2, height: 2, pixels: new Float64Array([frameSerial, 65535, -32768, 2_147_483_647]),
      capturedAt: input.capturedAt, capturedAtSource: 'server-estimate', color: { kind: 'bayer', pattern: 'gbrg' },
    }

    const sample = physicalAlignmentSample(input.solved, { capturedAt: input.capturedAt, exposureSeconds: 2 }, fixture.site)

    const evidence: AlignmentFrameEvidence = {
      phase, position, sample, hint: input.solved, fieldHeightDegrees: 3,
      solution: { status: 'solved', ...input.solved, capturedAt: input.capturedAt,
        wcs: { width: 2, height: 2, referenceX: 1.25, referenceY: 1.75, ...input.solved, cd: [0.00043, 0.00032, 0.00032, -0.00043] } },
      physical: { site: fixture.site, before: mount, after: { ...mount, observedAt: sample.capturedAt },
        camera: { cameraName: 'Fixture camera', sensorWidthPixels: 8, sensorHeightPixels: 8, width: 2, height: 2,
          pixelWidthMicrons: 3.76, pixelHeightMicrons: 3.76, binX: 2, binY: 2, startX: 1, startY: 1 } },
    }

    await run.recordFrame(frame, evidence)

    return { frame, evidence, sample }
  }

  for (const [index, input] of reference.samples.entries()) await capture(input, 'baseline', index + 1)
  await run.recordBaseline([samples[0]!, samples[1]!, samples[2]!], fixture.site.latitudeDegrees, baseline.measurement)
  await run.recordMeasurement(samples[2]!, measureAlignment(baseline, samples[2]!, true), mount)
  const adjusted = await capture(reference.adjusted, 'adjusting', 3)
  const measurement = measureAlignment(baseline, adjusted.sample, true)
  await run.recordMeasurement(adjusted.sample, measurement, mount)
  // A second observation rotates only adjustment pixels, retaining the first solve's numbers.
  await capture(reference.adjusted, 'adjusting', 3)
  await run.recordMeasurement(adjusted.sample, measurement, mount)

  if (phase) await run.finish({ phase, error: phase === 'failed' ? 'Device read failed' : null })
  expect(onError).not.toHaveBeenCalled()
  const directory = join(root, (await readdir(root))[0]!)
  const journal = join(directory, diagnosticJournalName)
  const entries = (await readFile(journal, 'utf8')).trimEnd().split('\n').map(line => diagnosticEntrySchema.parse(JSON.parse(line)))

  return { directory, journal, entries, baseline, measurement, adjusted, runId }
}

async function replaceEntries(journal: string, entries: DiagnosticEntry[]) {
  await writeFile(journal, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
}

describe('alignment diagnostic replay', () => {
  it('reproduces physical math and retains exact pixels, start provenance, midpoint, WCS, and only the latest adjustment original', async () => {
    const trial = await physicalTrial('finished')
    const frames = trial.entries.filter(entry => entry.type === 'frame')
    expect(frames).toHaveLength(5)
    expect(frames[4]!.evidence).toEqual(trial.adjusted.evidence)
    expect(Date.parse(frames[4]!.evidence.sample.capturedAt) - Date.parse(frames[4]!.capture.capturedAt)).toBe(1000)
    const fits = await readFile(join(trial.directory, frames[4]!.original.filename))
    const header = fits.subarray(0, 2880).toString('ascii')
    expect(frames[4]!.capture.capturedAt).toBe(trial.adjusted.frame.capturedAt)
    expect(header).toContain(new Date(trial.adjusted.frame.capturedAt).toISOString())
    expect(header).toContain('SERVER-ESTIMATE')
    expect(header).toContain('GBRG')
    expect([0, 1, 2, 3].map(index => fits.readInt32BE(2880 + index * 4))).toEqual([5, 65535, -32768, 2_147_483_647])
    const baselineFits = await readFile(join(trial.directory, frames[0]!.original.filename))
    expect(baselineFits.readInt32BE(2880)).toBe(1)
    const filenames = await readdir(trial.directory)
    expect(filenames.filter(name => name.endsWith('.fits'))).toHaveLength(4)
    expect(filenames).not.toContain(frames[3]!.original.filename)
    expect(filenames).toEqual(expect.arrayContaining(frames.filter((_, index) => index !== 3).map(frame => frame.original.filename)))

    const report = await replayAlignmentDiagnostics(trial.directory)
    expect(report).toMatchObject({ validation: 'production-math-reproducibility-only', mode: 'physical', runId: trial.runId,
      outcome: { phase: 'finished', error: null }, counts: { frames: 5, measurements: 3, physicalFrames: 5, verifiedOriginals: 4 },
      baseline: trial.baseline, finalMeasurement: trial.measurement,
      maximumDiscrepancies: { measurementArcsec: 0, correctionTargetDegrees: 0, physicalSampleDegrees: 0, physicalSampleTimeMs: 0 } })
    expect(Math.abs(report.baseline!.measurement.altitudeArcsec - fixture.cases[1]!.altitude)).toBeLessThan(1)
  })

  it.each(['stopped', 'failed', undefined] as const)('reports %s without implying a completed alignment trial', async phase => {
    const trial = await physicalTrial(phase)
    const report = await replayAlignmentDiagnostics(trial.directory)
    expect(report.outcome).toEqual({ phase: phase ?? 'incomplete', error: phase === 'failed' ? 'Device read failed' : null })
    expect(report.truncatedFinalLine).toBe(false)
  })

  it('ignores an uncommitted truncated final line but rejects complete malformed entries', async () => {
    const trial = await physicalTrial('finished')
    const journal = await readFile(trial.journal, 'utf8')
    await writeFile(trial.journal, journal.slice(0, -8))
    expect(await replayAlignmentDiagnostics(trial.directory)).toMatchObject({ outcome: { phase: 'incomplete' }, truncatedFinalLine: true })
    await writeFile(trial.journal, journal.slice(0, journal.lastIndexOf('{"type":"outcome"')) + '{broken}\n')
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('Invalid alignment diagnostic journal entry')
  })

  it('reports numerical discrepancies rather than silently treating recorded results as recomputation', async () => {
    const trial = await physicalTrial('finished')
    const measurement = trial.entries.find(entry => entry.type === 'measurement')!

    if (measurement.type !== 'measurement') throw new Error('Missing fixture measurement')
    measurement.measurement.altitudeArcsec += 12
    measurement.measurement.correctionTarget.decDegrees += 0.5
    await replaceEntries(trial.journal, trial.entries)
    expect((await replayAlignmentDiagnostics(trial.directory)).maximumDiscrepancies).toMatchObject({ measurementArcsec: 12, correctionTargetDegrees: 0.5 })
    const run = trial.entries[0]!

    if (run.type !== 'run') throw new Error('Missing fixture run')
    run.run.exposureSeconds += 2
    await replaceEntries(trial.journal, trial.entries)
    const discrepancies = (await replayAlignmentDiagnostics(trial.directory)).maximumDiscrepancies
    expect(discrepancies.physicalSampleTimeMs).toBe(1000)
    expect(discrepancies.physicalSampleDegrees).toBeGreaterThan(0.004)
  })

  it('rejects missing essential evidence and journal-supplied traversal paths', async () => {
    const trial = await physicalTrial('finished')
    await replaceEntries(trial.journal, trial.entries.filter(entry => entry.type !== 'baseline'))
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('missing its baseline')
    const firstFrame = trial.entries.find(entry => entry.type === 'frame')!

    if (firstFrame.type !== 'frame') throw new Error('Missing fixture frame')
    const physical = firstFrame.evidence.physical
    delete firstFrame.evidence.physical
    await replaceEntries(trial.journal, trial.entries)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('missing physical inputs')
    firstFrame.evidence.physical = physical
    firstFrame.original.filename = '../outside.fits'
    await replaceEntries(trial.journal, trial.entries)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('Invalid alignment diagnostic journal entry')
  })

  it('rejects damaged, missing, symlinked, and oversized retained originals', async () => {
    const trial = await physicalTrial('finished')
    const latest = trial.entries.filter(entry => entry.type === 'frame').at(-1)!
    const original = join(trial.directory, latest.original.filename)
    const fits = await readFile(original)
    fits[2880] = 1
    await writeFile(original, fits)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('integrity failure')
    await truncate(original, maximumFitsBytes + 1)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('size cap')
    await unlink(original)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('ENOENT')
    await symlink(trial.journal, original)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('ELOOP')
  })

  it('caps external journals before reading and rejects entries after a final outcome', async () => {
    const trial = await physicalTrial('finished')
    await appendFile(trial.journal, JSON.stringify(trial.entries[1]) + '\n')
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('after its outcome')
    await truncate(trial.journal, maximumJournalBytes + 1)
    await expect(replayAlignmentDiagnostics(trial.directory)).rejects.toThrow('size cap')
  })
})
