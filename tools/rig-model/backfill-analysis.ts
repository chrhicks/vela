import { epochMs, type EpochMs } from '@vela/rig-events'
import type { Trial } from '@vela/rig-frames'
import type { FrameRow } from './backfill-replay.ts'

/** Earth's rotation in radians per second. A polar error of E drifts the sky by at most E times this. */
const siderealRate = 7.2921159e-5

/** A run needs this many fixes over this long before a slope means anything. */
export const minDriftFrames = 4

export const minDriftSpanMs = 5 * 60_000

/** How far above the last alignment the drift must put the polar error before it counts as a change, in arcminutes. */
export const marginArcmin = 20

export interface Residual {
  readonly east: number
  readonly north: number
  readonly total: number
}

/** The pointing residual of one frame, or why it has none. */
export type Pointing = { readonly kind: 'fix'; readonly epoch: number; readonly at: EpochMs; readonly arcmin: Residual } | { readonly kind: 'none'; readonly reason: string }

export function pointingOf(row: FrameRow): Pointing {
  const { join } = row

  if (join.outcome === 'fix') return { kind: 'fix', epoch: join.fix.epoch, at: join.fix.at, arcmin: join.fix.errorArcmin }

  return { kind: 'none', reason: join.outcome === 'rejected' ? join.reason : 'undecided' }
}

export interface Drift {
  readonly epoch: number
  readonly from: EpochMs
  readonly to: EpochMs
  readonly frames: number
  /** Arcseconds per minute of the residual's change across the run, on the sky: east along the parallel, north along the meridian. */
  readonly eastArcsecPerMin: number
  readonly northArcsecPerMin: number
  readonly eastSe: number
  readonly northSe: number
  /** The least polar error that explains the drift's speed at two standard errors, in arcminutes. */
  readonly polarLowerArcmin: number
}

/** A run is back-to-back exposures: the next starts within this long of the last one ending. A pause means guiding, calibration or a slew, and the drift across it is not one drift. */
export const maxRunGapMs = 60_000

function slope(points: readonly (readonly [number, number])[]) {
  const n = points.length
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / n
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n
  const sxx = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0)
  const sxy = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0)
  const fit = sxy / sxx
  const sse = points.reduce((sum, [x, y]) => sum + (y - meanY - fit * (x - meanX)) ** 2, 0)

  return { slope: fit, se: Math.sqrt(sse / (n - 2) / sxx) }
}

interface Fixed {
  readonly epoch: number
  readonly startedAt: EpochMs
  readonly endedAt: EpochMs
  readonly at: EpochMs
  readonly arcmin: Residual
}

/**
 * The drift of the pointing residual in each run of back-to-back exposures inside one motion epoch, for runs with
 * enough fixes over enough time. Nothing moved the mount in an epoch, so a steady change of the residual is the sky
 * sliding past a mount that tracks it. The sky's speed past the mount is at most the polar error times Earth's rotation
 * rate, in whatever direction. A guided run drifts little whatever the polar error is, so a small drift proves nothing
 * about the polar axis. A large one proves a polar error at least that big, if nothing else drifts the field.
 */
export function driftsOf(rows: readonly FrameRow[]): Drift[] {
  const runs: Fixed[][] = []

  for (const row of rows.toSorted((a, b) => a.capturedAt - b.capturedAt)) {
    const pointing = pointingOf(row)

    if (pointing.kind !== 'fix') continue

    const fixed: Fixed = { epoch: pointing.epoch, startedAt: row.capturedAt, endedAt: epochMs(row.capturedAt + row.exposureSeconds * 1000), at: pointing.at, arcmin: pointing.arcmin }
    const run = runs[runs.length - 1]
    const previous = run?.[run.length - 1]

    if (run !== undefined && previous !== undefined && previous.epoch === fixed.epoch && fixed.startedAt - previous.endedAt <= maxRunGapMs) run.push(fixed)
    else runs.push([fixed])
  }

  return runs.flatMap((run): Drift[] => {
    const first = run[0]
    const last = run[run.length - 1]

    if (first === undefined || last === undefined || run.length < minDriftFrames || last.at - first.at < minDriftSpanMs) return []

    const minutes = (at: EpochMs) => (at - first.at) / 60_000
    const east = slope(run.map(fix => [minutes(fix.at), fix.arcmin.east * 60]))
    const north = slope(run.map(fix => [minutes(fix.at), fix.arcmin.north * 60]))
    const lowerDrift = Math.max(0, Math.hypot(east.slope, north.slope) - 2 * Math.hypot(east.se, north.se))

    return [
      {
        epoch: first.epoch,
        from: first.startedAt,
        to: last.endedAt,
        frames: run.length,
        eastArcsecPerMin: east.slope,
        northArcsecPerMin: north.slope,
        eastSe: east.se,
        northSe: north.se,
        polarLowerArcmin: lowerDrift / (siderealRate * 60) / 60,
      },
    ]
  })
}

/** What Vela's alignment last measured of the polar axis: the final reading of a trial, whatever the trial's outcome. */
export interface Alignment {
  readonly runId: string
  readonly outcome: Trial['outcome']
  readonly at: EpochMs
  readonly totalArcmin: number
}

/** The newest trial's last reading at or before `at`. A reading is what was measured then, even when the trial was stopped or failed after it. */
export function alignmentBefore(trials: readonly Trial[], at: EpochMs): Alignment | undefined {
  return trials
    .flatMap((trial): Alignment[] => {
      const last = trial.readings[trial.readings.length - 1]

      return last !== undefined && last.at <= at ? [{ runId: trial.runId, outcome: trial.outcome, at: last.at, totalArcmin: last.totalArcsec / 60 }] : []
    })
    .toSorted((a, b) => b.at - a.at)[0]
}

/** An exposure Cria was told to take: when, and for how long. */
export interface Exposure {
  readonly at: EpochMs
  readonly seconds: number
}

const sameExposureMs = 30_000

/** The commanded exposures that no kept file matches by start time (within 30 s) and length. */
export function unkept(commanded: readonly Exposure[], kept: readonly Exposure[]): Exposure[] {
  return commanded.filter(exposure => !kept.some(file => Math.abs(file.at - exposure.at) <= sameExposureMs && Math.abs(file.seconds - exposure.seconds) < 0.5))
}

export interface Shift {
  /** The alignment that last vouched for the polar axis, and the start of the first run of exposures that it cannot explain. */
  readonly from: EpochMs
  readonly to: EpochMs
  readonly alignment: Alignment
  readonly drift: Drift
  /** Exposures commanded inside the bracket whose pixels were not kept; undefined when no record of commands exists for the night. */
  readonly unkept: readonly Exposure[] | undefined
}

export type Finding =
  | { readonly kind: 'no-alignment' }
  | { readonly kind: 'steady'; readonly tested: number }
  | { readonly kind: 'shift'; readonly shift: Shift; readonly complete: boolean }

/**
 * Holds each run's drift against the polar error the last alignment measured. A drift that needs more
 * polar error than that, by more than the margin, says the polar axis moved after the alignment. A run that does
 * not need more proves nothing, since a drift only bounds the polar error from below, so only the alignment itself
 * is evidence that the axis was where it left it. The bracket runs from that alignment to the start of the first
 * run that disagrees. It is complete only when no exposure commanded inside it lacks kept pixels, which could have
 * narrowed it.
 */
export function findingOf(options: { readonly drifts: readonly Drift[]; readonly trials: readonly Trial[]; readonly commanded: readonly Exposure[] | undefined; readonly kept: readonly Exposure[] }): Finding {
  let tested = 0

  for (const drift of options.drifts) {
    const alignment = alignmentBefore(options.trials, drift.from)

    if (alignment === undefined) continue

    tested++

    if (drift.polarLowerArcmin <= alignment.totalArcmin + marginArcmin) continue

    const inside = options.commanded?.filter(exposure => exposure.at > alignment.at && exposure.at < drift.from)
    const lost = inside === undefined ? undefined : unkept(inside, options.kept)

    return { kind: 'shift', shift: { from: alignment.at, to: drift.from, alignment, drift, unkept: lost }, complete: lost !== undefined && lost.length === 0 }
  }

  return tested === 0 ? { kind: 'no-alignment' } : { kind: 'steady', tested }
}

export type Outcome = { readonly code: 0 | 1 | 3; readonly word: 'complete' | 'failed' | 'incomplete'; readonly reasons: readonly string[] }

/**
 * The tool's one answer. *failed* is a night that contradicts what was asked of it: the event night shows no change,
 * or the control night shows one. *incomplete* is a change that is found but not as narrow as the pixels could make it.
 * Failing outranks incomplete, and neither is *complete*.
 */
export function outcomeOf(nights: readonly { readonly night: string; readonly finding: Finding }[], expected: { readonly event: string | undefined; readonly control: string | undefined }): Outcome {
  const failed: string[] = []
  const incomplete: string[] = []
  const find = (night: string) => nights.find(candidate => candidate.night === night)

  for (const [name, night] of [['event', expected.event], ['control', expected.control]] as const) {
    if (night !== undefined && find(night) === undefined) failed.push(`the ${name} night ${night} has no light frames`)
  }

  const event = expected.event === undefined ? undefined : find(expected.event)
  const control = expected.control === undefined ? undefined : find(expected.control)

  if (event !== undefined && event.finding.kind !== 'shift') failed.push(`the event night ${event.night} shows no change of the polar axis`)

  if (control !== undefined && control.finding.kind === 'shift') failed.push(`the control night ${control.night} shows a change of the polar axis`)

  for (const { night, finding } of nights) if (finding.kind === 'shift' && !finding.complete) incomplete.push(`${night}: a change is bracketed but exposures inside the bracket have no kept pixels`)

  if (failed.length > 0) return { code: 1, word: 'failed', reasons: failed }

  return incomplete.length > 0 ? { code: 3, word: 'incomplete', reasons: incomplete } : { code: 0, word: 'complete', reasons: [] }
}
