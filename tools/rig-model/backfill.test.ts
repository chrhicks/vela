import { describe, expect, it } from 'vitest'
import { epochMs, type RigEvent, type SolveBody } from '@vela/rig-events'
import type { SavedImage, Trial } from '@vela/rig-frames'
import { imageIdOf, snapshot, steady } from '@vela/rig-testing'
import { driftsOf, findingOf, outcomeOf, unkept, type Exposure } from './backfill-analysis.ts'
import { arrivals, replayNight, type Solved } from './backfill-replay.ts'

const T0 = Date.UTC(2026, 9, 26, 23, 50, 0)

const sky = { raHours: 5, decDegrees: 40 }

const mountAt = (at: number, decDegrees: number = sky.decDegrees) => snapshot({ at, mount: { at, raHours: sky.raHours, decDegrees, frame: 'j2000' } })

async function* stream(events: readonly RigEvent[]): AsyncGenerator<RigEvent> {
  yield* events
}

const tracking = (from: number, to: number) => steady({ from, to, mount: { at: 0, ...sky, frame: 'j2000' } })

function imageOf(index: number, capturedAt: number, exposureSeconds: number): SavedImage {
  return {
    id: imageIdOf(index),
    rigId: 'test-rig',
    frameType: 'light',
    capturedAt: epochMs(capturedAt),
    capturedAtSource: 'camera',
    receivedAt: epochMs(capturedAt + exposureSeconds * 1000 + 1500),
    savedAt: epochMs(capturedAt + exposureSeconds * 1000 + 1600),
    exposureSeconds,
    width: 6248,
    height: 4176,
    filter: null,
    fitsPath: '/not/read/in/these/tests.fits',
    fitsBytes: 0,
  }
}

function solvedAt(index: number, capturedAt: number, exposureSeconds: number, decDegrees: number, solveMs = 900, raDegrees = sky.raHours * 15): Solved {
  const centre = { raDegrees, decDegrees }

  const body: SolveBody = {
    status: 'solved',
    imageId: imageIdOf(index),
    solverVersion: 'astap-test',
    solveMs,
    hint: null,
    centre,
    wcs: { width: 6248, height: 4176, referenceX: 3124.5, referenceY: 2088.5, ...centre, cd: [-0.0005, 0, 0, 0.0005] },
  }

  return { capture: { image: imageOf(index, capturedAt, exposureSeconds), record: undefined }, body }
}

const arcsecInDegrees = 1 / 3600

const fast = -8

describe('rig backfill', () => {
  it('reads the mount at the exposure midpoint', async () => {
    const stepDegrees = 0.008

    const nightWith = async (changeAt: number) => {
      const before = tracking(T0 - 60_000, changeAt)
      const after = tracking(changeAt + 1000, T0 + 90_000).map(event => mountAt(event.at, sky.decDegrees + stepDegrees))
      const { rows } = await replayNight({ solved: [solvedAt(1, T0, 30, sky.decDegrees + stepDegrees)], mount: stream([...before, ...after]), settleMs: 600_000 })

      return rows[0]
    }

    const early = await nightWith(T0 + 10_000)
    const late = await nightWith(T0 + 20_000)

    expect(early?.midpoint).toBe(T0 + 15_000)
    expect(early?.join).toMatchObject({ outcome: 'fix' })
    expect(early?.join.outcome === 'fix' && early.join.fix.errorArcmin.north).toBeCloseTo(0, 3)
    expect(late?.join.outcome === 'fix' && late.join.fix.errorArcmin.north).toBeCloseTo(stepDegrees * 60, 3)
  })

  it('stamps a frame with the end of its exposure and a solve with its finish', async () => {
    const solved = solvedAt(1, T0, 30, sky.decDegrees, 1200)
    const { frame, solve } = arrivals(solved)
    const withRecord = arrivals({ ...solved, capture: { ...solved.capture, record: { ...unrecorded(solved), runId: 'run-9' } } })

    expect(frame.seenAt).toBe(T0 + 30_000)
    expect(solve.seenAt).toBe(T0 + 31_200)
    expect(frame.kind === 'frame' && frame.body.origin).toBe('import')
    expect(withRecord.frame.kind === 'frame' && [withRecord.frame.body.runId, withRecord.frame.body.origin]).toEqual(['run-9', 'capture-run'])

    const { rows } = await replayNight({ solved: [solved], mount: stream(tracking(T0 - 60_000, T0 + 90_000)), settleMs: 600_000 })

    expect(rows[0]?.join.outcome).toBe('fix')
  })

  it('fits the drift of a run and the polar error it needs', async () => {
    const solved = drifting(fast)
    const { rows } = await replayNight({ solved, mount: stream(tracking(T0 - 60_000, T0 + 20 * 60_000)), settleMs: 600_000 })
    const [drift, ...others] = driftsOf(rows)

    expect(others).toEqual([])
    expect(drift?.frames).toBe(20)
    expect(drift?.northArcsecPerMin).toBeCloseTo(fast, 1)
    expect(drift?.polarLowerArcmin).toBeCloseTo(-fast / (7.2921159e-5 * 60) / 60, 0)
  })

  it('brackets a change after an alignment, and is incomplete while exposures in the bracket lack pixels', async () => {
    const { rows } = await replayNight({ solved: drifting(fast), mount: stream(tracking(T0 - 60_000, T0 + 20 * 60_000)), settleMs: 600_000 })
    const drifts = driftsOf(rows)
    const trials = [trial('finished', T0 - 15 * 60_000, 60)]
    const inside: Exposure[] = [10, 11, 12].map(minute => ({ at: epochMs(T0 - minute * 30_000), seconds: 10 }))
    const commanded: Exposure[] = [{ at: epochMs(T0 - 20 * 60_000), seconds: 10 }, ...inside, { at: epochMs(T0 + 20 * 60_000), seconds: 30 }]

    const finding = findingOf({ drifts, trials, commanded, kept: [] })

    expect(finding.kind).toBe('shift')

    if (finding.kind !== 'shift') return

    expect(finding.shift.from).toBe(T0 - 15 * 60_000)
    expect(finding.shift.to).toBeGreaterThan(T0)
    expect(finding.shift.to).toBeLessThan(T0 + 20 * 37_000)
    expect(finding.complete).toBe(false)
    expect(finding.shift.unkept).toHaveLength(3)

    const kept = inside.map(exposure => ({ at: epochMs(exposure.at + 2000), seconds: 10 }))

    expect(unkept(inside, kept)).toEqual([])
    expect(findingOf({ drifts, trials, commanded, kept })).toMatchObject({ kind: 'shift', complete: true })
    expect(findingOf({ drifts, trials, commanded: undefined, kept })).toMatchObject({ kind: 'shift', complete: false })
    expect(findingOf({ drifts, trials: [trial('stopped', T0 - 15 * 60_000, 60)], commanded, kept: [] })).toMatchObject({ kind: 'shift', shift: { alignment: { outcome: 'stopped' } } })
  })

  it('ends the bracket where the shortest disagreeing stretch ends, so a change inside a run is inside it', async () => {
    const stepAt = 4 * 60_000

    const steady = Array.from({ length: 21 }, (_, index) => {
      const offset = index * 30_000
      const minutes = Math.max(0, offset - stepAt) / 60_000

      return solvedAt(index + 1, T0 + offset, 25, sky.decDegrees + (minutes > 0 ? 60 + 16 * minutes : 0) * arcsecInDegrees)
    })

    const { rows } = await replayNight({ solved: steady, mount: stream(tracking(T0 - 60_000, T0 + 15 * 60_000)), settleMs: 600_000 })
    const finding = findingOf({ drifts: driftsOf(rows), trials: [trial('finished', T0 - 15 * 60_000, 60)], commanded: [], kept: [] })

    expect(finding.kind).toBe('shift')
    expect(finding.kind === 'shift' && finding.shift.to).toBeGreaterThan(T0 + stepAt)
  })

  it('does not call a drift a polar shift without a later alignment as large as it needs', async () => {
    const eastOnly = Array.from({ length: 20 }, (_, index) => {
      const eastDegrees = (8 * arcsecInDegrees * ((index * 37_000) / 60_000)) / Math.cos((sky.decDegrees * Math.PI) / 180)

      return solvedAt(index + 1, T0 + index * 37_000, 30, sky.decDegrees, 900, sky.raHours * 15 + eastDegrees)
    })

    const { rows } = await replayNight({ solved: eastOnly, mount: stream(tracking(T0 - 60_000, T0 + 20 * 60_000)), settleMs: 600_000 })
    const alone = findingOf({ drifts: driftsOf(rows), trials: [trial('finished', T0 - 15 * 60_000, 60)], commanded: [], kept: [] })
    const later = findingOf({ drifts: driftsOf(rows), trials: [trial('finished', T0 - 15 * 60_000, 60), { ...trial('finished', T0 + 40 * 60_000, 2400), runId: 'later' }], commanded: [], kept: [] })

    expect(alone).toMatchObject({ kind: 'shift', shift: { corroboration: undefined } })
    expect(later).toMatchObject({ kind: 'shift', shift: { corroboration: { runId: 'later' } } })
    expect(outcomeOf([{ night: 'e', finding: alone }], { event: 'e', control: undefined })).toMatchObject({ code: 1 })
    expect(outcomeOf([{ night: 'e', finding: later }], { event: 'e', control: undefined })).toMatchObject({ code: 0 })
    expect(outcomeOf([{ night: 'c', finding: { kind: 'no-alignment' } }], { event: undefined, control: 'c' })).toMatchObject({ code: 1 })
  })

  it('exits incomplete for the event night, passed for a quiet control, and failed when they swap', async () => {
    const run = async (north: number) => {
      const { rows } = await replayNight({ solved: drifting(north), mount: stream(tracking(T0 - 60_000, T0 + 20 * 60_000)), settleMs: 600_000 })

      return findingOf({ drifts: driftsOf(rows), trials: [trial('finished', T0 - 15 * 60_000, 60), { ...trial('finished', T0 + 40 * 60_000, 2400), runId: 'later' }], commanded: [{ at: epochMs(T0 - 5 * 60_000), seconds: 10 }], kept: [] })
    }

    const event = { night: '2026-10-26', finding: await run(fast) }
    const control = { night: '2026-10-24', finding: await run(0) }

    expect(control.finding).toMatchObject({ kind: 'steady' })
    expect(outcomeOf([event, control], { event: event.night, control: control.night })).toMatchObject({ code: 3, word: 'incomplete' })
    expect(outcomeOf([control], { event: undefined, control: undefined })).toMatchObject({ code: 0, word: 'complete' })
    expect(outcomeOf([{ ...event, night: control.night }, { ...control, night: event.night }], { event: event.night, control: control.night })).toMatchObject({ code: 1, word: 'failed' })
    expect(outcomeOf([control], { event: event.night, control: undefined })).toMatchObject({ code: 1 })
  })
})

function unrecorded({ capture }: Solved) {
  const { image } = capture

  return {
    line: 1,
    rigId: image.rigId,
    runId: 'unrecorded',
    attempt: 1,
    startedAt: image.capturedAt,
    settledAt: image.receivedAt,
    exposureSeconds: image.exposureSeconds,
    frameType: image.frameType,
    subject: null,
    outcome: 'saved' as const,
    image: { id: image.id, capturedAt: image.capturedAt, capturedAtSource: 'camera' as const, receivedAt: image.receivedAt, width: image.width, height: image.height },
    statistics: null,
  }
}

/** Twenty 30 s exposures, 37 s apart, whose solved centre slides north by `arcsecPerMin` from the first one's midpoint. */
function drifting(arcsecPerMin: number): Solved[] {
  return Array.from({ length: 20 }, (_, index) => {
    const capturedAt = T0 + index * 37_000
    const minutes = (index * 37_000) / 60_000

    return solvedAt(index + 1, capturedAt, 30, sky.decDegrees + arcsecPerMin * minutes * arcsecInDegrees)
  })
}

function trial(outcome: Trial['outcome'], at: number, totalArcsec: number): Trial {
  return {
    directory: '/not/read',
    runId: '2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8',
    rigId: 'test-rig',
    mode: 'physical',
    createdAt: epochMs(at - 600_000),
    exposureSeconds: 2,
    outcome,
    frames: [],
    readings: [{ line: 1, phase: 'adjusting', at: epochMs(at), altitudeArcsec: totalArcsec, azimuthArcsec: 0, totalArcsec }],
    baselines: 1,
    measurements: 1,
  }
}
