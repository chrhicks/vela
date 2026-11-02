import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitPolarAxis } from '@vela/rig-sky'
import { simulatorSiderealDegrees } from './alignment-events.js'
import { createAlignmentDiagnostics, type AlignmentFrameEvidence } from './diagnostics.js'
import { openRunLog } from '../run-log/run-log.js'
import { decodeLine, encodeEvent, seal } from '@vela/rig-events'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'
import { baselineFromAxis, measureAlignment } from './geometry.js'
import { readBothFormats } from './events-fixture.js'
import { fixture } from './physical-fixture.js'
import { sweepFix } from './sweep-fit.js'

const roots: string[] = []

interface ReadTrials {
  readTrials(root: string, runLog?: string): Promise<{
    problems: unknown[]
    trials: {
      outcome: string
      frames: { phase: string; position: number }[]
      dropped: { position: number; reason: string }[]
      fits: { positions: number[]; status: string; missArcmin: number; thresholdArcmin: number; steps: { before: string; after: string }[] }[]
      readings: { phase: string }[]
    }[]
  }>
}

/** The server's type-checked build cannot compile `rig-frames` source, so the reader is loaded at run time. */
// SAFETY: the module is `rig-frames`' index, whose `readTrials` has the shape declared above.
const { readTrials } = (await import(new URL('../../../../packages/rig-frames/src/index.ts', import.meta.url).href)) as ReadTrials

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const simulator = { latitudeDegrees: fixture.site.latitudeDegrees, siderealTimeDegrees: 40, at: new Date(Date.UTC(2026, 10, 1, 4, 0, 0)).toISOString() }

const decDegrees = 60

const cdAt = (rollDegrees: number): [number, number, number, number] => {
  const roll = (rollDegrees * Math.PI) / 180
  const scale = 0.0004

  return [scale * Math.cos(roll), -scale * Math.sin(roll), scale * Math.sin(roll), scale * Math.cos(roll)]
}

/** Position 1 to 6 of a pole-aligned mount turning 20 degrees a position, the camera rolled a further `slipDegrees` from position 5 on. */
function sweep(slipDegrees: number) {
  return [1, 2, 3, 4, 5, 6].map(position => {
    const raDegrees = 100 + 20 * (position - 1)
    const capturedAt = new Date(Date.UTC(2026, 10, 1, 4, 0, position * 10)).toISOString()

    return { position, raDegrees, capturedAt, rollDegrees: position >= 5 ? slipDegrees : 0 }
  })
}

async function recordSweep(slipDegrees: number, drop: number) {
  const root = await mkdtemp(join(tmpdir(), 'vela-diagnostic-fit-test-'))
  roots.push(root)
  const onError = vi.fn()

  const trialsRoot = join(root, 'trials')
  const runLog = join(root, 'log')
  const log = openRunLog({ directory: runLog })

  const run = (await createAlignmentDiagnostics(
    trialsRoot,
    log,
    onError,
  )({
    runId: randomUUID(),
    rigId: 'simulator',
    rigName: 'Simulator',
    mode: 'offline',
    simulator,
    cameraId: 'camera',
    telescopeId: 'mount',
    cameraName: 'Simulator camera',
    exposureSeconds: 2,
  }))!

  const kept: { position: number; evidence: AlignmentFrameEvidence }[] = []

  for (const { position, raDegrees, capturedAt, rollDegrees } of sweep(slipDegrees)) {
    if (position === drop) {
      await run.recordDropped(position, 'no-solve', 'ASTAP found no solution')
      continue
    }

    const solved = { raDegrees, decDegrees }
    const siderealTimeDegrees = simulatorSiderealDegrees(simulator, capturedAt)

    const evidence: AlignmentFrameEvidence = {
      phase: 'baseline',
      position,
      sample: { ...solved, capturedAt, siderealTimeDegrees },
      hint: solved,
      fieldHeightDegrees: 3,
      solution: { status: 'solved', ...solved, capturedAt, wcs: { width: 2, height: 2, referenceX: 1, referenceY: 1, ...solved, cd: cdAt(rollDegrees) } },
      offlinePointing: { rightAscensionDegrees: raDegrees, declinationDegrees: decDegrees, siderealTimeDegrees, latitudeDegrees: fixture.site.latitudeDegrees, tracking: true, coordinateSystem: 'topocentric' },
    }

    await run.recordFrame({ width: 2, height: 2, pixels: new Float64Array([position, 2, 3, 4]), capturedAt, capturedAtSource: 'camera', color: { kind: 'mono' } }, evidence)
    kept.push({ position, evidence })
  }

  const fit = fitPolarAxis(
    kept.map(({ position, evidence }) => sweepFix(position, evidence)),
    fixture.site.latitudeDegrees,
  )

  const fixes = kept.map(({ position, evidence }) => ({ position, sample: evidence.sample }))

  await run.recordFit(fixes, fixture.site.latitudeDegrees, fit)

  const last = fixes.at(-1)!.sample
  const baseline = fit.verdict.status === 'rigid' ? baselineFromAxis(fit.axis, last, fixture.site.latitudeDegrees) : undefined

  if (baseline) await run.recordMeasurement(last, measureAlignment(baseline, last, true))
  await run.finish(baseline ? { phase: 'finished', error: null } : { phase: 'failed', error: 'not rigid' })
  expect(onError).not.toHaveBeenCalled()

  await log.close()

  return { root: trialsRoot, runLog, directory: join(trialsRoot, (await readdir(trialsRoot))[0]!), fit, baseline }
}

describe('a run log of five fixes and one dropped position', () => {
  it('replays a rigid sweep from its recorded frames and rebuilds the adjusting baseline from the fitted axis', async () => {
    const { directory, runLog, fit, baseline } = await recordSweep(0, 4)
    const report = await replayAlignmentDiagnostics(directory, runLog)

    const both = await readBothFormats(directory, runLog)
    expect(both.events).toEqual(both.journal)
    expect(both.events.trials).toHaveLength(1)
    expect(both.events.problems).toEqual([])
    expect(report.counts).toMatchObject({ frames: 5, measurements: 1, verifiedOriginals: 5 })
    expect(report.dropped).toEqual([{ position: 4, reason: 'no-solve' }])
    expect(report.rigidity?.status).toBe('rigid')
    expect(report.fit?.axis).toEqual(fit.axis)
    expect(report.baseline).toEqual(baseline)
    expect(report.outcome).toEqual({ phase: 'finished', error: null })
    expect(Math.max(...Object.values(report.maximumDiscrepancies))).toBeLessThan(1e-9)
  })

  it('reads back through readTrials with the dropped fix, the fit and the polar readings', async () => {
    const { root, runLog } = await recordSweep(0, 4)
    const { trials, problems } = await readTrials(root, runLog)
    const [trial] = trials

    expect(problems).toEqual([])
    expect(trial?.frames.map(frame => [frame.phase, frame.position])).toEqual([1, 2, 3, 5, 6].map(position => ['baseline', position]))
    expect(trial?.dropped.map(({ position, reason }) => [position, reason])).toEqual([[4, 'no-solve']])
    expect(trial?.fits.map(({ positions, status, steps }) => [positions, status, steps])).toEqual([[[1, 2, 3, 5, 6], 'rigid', []]])
    expect(trial?.readings.map(reading => reading.phase)).toEqual(['baseline', 'adjusting'])
    expect(trial?.outcome).toBe('finished')
  })

  it('names the step in a sweep whose camera slipped and gives it no polar reading', async () => {
    const { root, runLog, directory } = await recordSweep(0.5, 4)
    const { trials } = await readTrials(root, runLog)
    const report = await replayAlignmentDiagnostics(directory, runLog)

    expect(trials[0]?.fits[0]).toMatchObject({ status: 'not-rigid', steps: [{ before: '3', after: '5' }] })
    expect(trials[0]?.fits[0]?.missArcmin).toBeGreaterThan(trials[0]!.fits[0]!.thresholdArcmin)
    expect(trials[0]?.readings).toEqual([])
    expect([report.rigidity?.status, report.baseline, report.finalMeasurement]).toEqual(['not-rigid', null, null])
    expect(report.fit).toBeNull()
    expect(report.rigidity && 'steps' in report.rigidity && report.rigidity.steps.map(step => [step.labelBefore, step.labelAfter])).toEqual([['3', '5']])
  })

  it('refuses a fit entry that disagrees with the frames it names', async () => {
    const { directory, runLog } = await recordSweep(0, 4)
    const journal = join(runLog, (await readdir(runLog))[0]!)
    const lines = (await readFile(journal, 'utf8')).trimEnd().split('\n')
    const index = lines.findIndex(line => line.includes('"type":"fit"'))
    const decoded = decodeLine(lines[index]!)

    if (!decoded.ok || decoded.event.kind !== 'alignment' || decoded.event.body.type !== 'fit') throw new Error('expected a fit entry')
    const event = decoded.event
    const body = decoded.event.body
    lines[index] = encodeEvent(seal({ ...event, body: { ...body, verdict: { ...body.verdict, status: 'not-rigid' } } }))
    await writeFile(journal, lines.join('\n') + '\n')

    await expect(replayAlignmentDiagnostics(directory, runLog)).rejects.toThrow('disagrees')
  })

})
