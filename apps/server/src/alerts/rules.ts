import type { AlertThresholds } from './thresholds.js'

export type AlertLevel = 'warn' | 'critical'

export type AlertId =
  | 'stars-low'
  | 'stars-collapsed'
  | 'stars-declining'
  | 'hfr-high'
  | 'hfr-bad'
  | 'tracking-stopped'
  | 'meridian-near'
  | 'meridian-imminent'
  | 'rig-unreachable'
  | 'frames-stalled'
  | 'run-failed'

export interface AlertCondition {
  id: AlertId
  level: AlertLevel
  message: string
}

/** One finished exposure. Times are epoch milliseconds. */
export interface Frame {
  capturedAt: number
  stars: number
  hfrPixels: number | null
}

/** One poll of the mount. A reading the mount did not give is null. */
export interface MountReading {
  tracking: boolean | null
  slewing: boolean | null
  parked: boolean | null
  rightAscensionHours: number | null
  siderealTimeHours: number | null
  pierSide: 'east' | 'west' | null
}

export type RunState =
  | { status: 'running'; exposureSeconds: number; waitingForFrameSince: number }
  | { status: 'stopped' }
  | { status: 'failed' }

export interface RigHistory {
  run: RunState
  /** Frames since the run started, the target changed or autofocus ended. Oldest first. */
  frames: Frame[]
  /** Mount polls since the run started. Oldest first. */
  mountReadings: MountReading[]
  /** When Cria stopped answering, or null while reads are current. */
  observationsInterruptedSince: number | null
}

export interface AlertEvaluation {
  conditions: AlertCondition[]
  /** Watches that cannot run, so silence is not mistaken for safe. */
  unavailable: string[]
}

export function evaluateAlerts(history: RigHistory, thresholds: AlertThresholds, now: number): AlertEvaluation {
  const { run } = history

  if (run.status === 'failed')
    return { conditions: [{ id: 'run-failed', level: 'critical', message: 'The capture run failed' }], unavailable: [] }

  if (run.status === 'stopped') return { conditions: [], unavailable: [] }

  const meridian = watchMeridian(history.mountReadings.at(-1), thresholds)

  return {
    conditions: [
      ...watchFrames(history.frames, thresholds),
      ...watchTracking(history.mountReadings, thresholds),
      ...meridian.conditions,
      ...watchReachability(history.observationsInterruptedSince, thresholds, now),
      ...watchFrameArrival(run, thresholds, now),
    ],
    unavailable: meridian.unavailable,
  }
}

// ---------------------------------------------------------------------------
// Frames

/**
 * Compares each frame with the run's own baseline: the median star count of
 * its last accepted frames. A frame is accepted when it is not itself bad, so
 * a stretch of cloud or a snagged camera never becomes the new normal.
 */
function watchFrames(frames: Frame[], t: AlertThresholds): AlertCondition[] {
  const acceptedStars: number[] = []
  const allStars: number[] = []
  let starsLow = calm
  let starsCollapsed = calm
  let starsDeclining = calm
  let hfrHigh = calm
  let hfrBad = calm
  let baseline = 0

  for (const frame of frames) {
    baseline = baselineStars(acceptedStars, t)
    allStars.push(frame.stars)

    const hfr = frame.hfrPixels
    const trend = starsTrend(allStars, t)
    const canCompare = baseline >= t.minBaselineStarsForRatios
    const empty = frame.stars === 0 && baseline >= t.minBaselineStarsForEmptyFrame
    const low = canCompare && frame.stars < t.starsLowRatio * baseline
    const collapsed = empty || (canCompare && frame.stars < t.starsCollapsedRatio * baseline)
    const recovered = frame.stars >= t.starsRecoveredRatio * baseline

    starsLow = latch(starsLow, low, recovered, 1)
    starsCollapsed = latch(starsCollapsed, collapsed, recovered, t.confirmFrames, t.confirmFrames)
    starsDeclining = latch(
      starsDeclining,
      trend !== null && trend.recent < t.starsDecliningRatio * trend.before,
      trend === null || trend.recent >= t.starsDecliningClearRatio * trend.before,
      1,
    )
    hfrHigh = latch(hfrHigh, hfr !== null && hfr > t.hfrHighPixels, hfr !== null && hfr < t.hfrHighClearPixels, t.confirmFrames)
    hfrBad = latch(hfrBad, hfr !== null && hfr > t.hfrBadPixels, hfr !== null && hfr < t.hfrBadClearPixels, t.confirmFrames)

    const bad = low || collapsed || (hfr !== null && hfr > t.hfrHighPixels)

    const inEpisode =
      starsLow.raised || starsCollapsed.raised || starsDeclining.raised || hfrHigh.raised || hfrBad.raised

    if (!bad && !inEpisode) acceptedStars.push(frame.stars)
  }

  const latest = frames.at(-1)

  if (!latest) return []

  const trend = starsTrend(allStars, t)
  const normal = `normal ≈${Math.round(baseline)} stars`
  const hfr = latest.hfrPixels?.toFixed(1)
  const conditions: AlertCondition[] = []

  if (starsLow.raised)
    conditions.push({ id: 'stars-low', level: 'warn', message: `Star count dropped to ${latest.stars} (${normal})` })

  if (starsCollapsed.raised)
    conditions.push({ id: 'stars-collapsed', level: 'critical', message: `Star count fell to ${latest.stars} (${normal})` })

  if (starsDeclining.raised && trend)
    conditions.push({ id: 'stars-declining', level: 'warn', message: `Star count falling: median ${Math.round(trend.recent)} (≈${Math.round(trend.before)} just before)` })

  if (hfrHigh.raised)
    conditions.push({ id: 'hfr-high', level: 'warn', message: `Stars are soft: HFR ${hfr ?? 'unmeasured'} px` })

  if (hfrBad.raised)
    conditions.push({ id: 'hfr-bad', level: 'critical', message: `Stars are badly out of focus: HFR ${hfr ?? 'unmeasured'} px` })

  return conditions
}

/** Median of the last accepted frames, or 0 until there are enough to trust. */
function baselineStars(acceptedStars: number[], t: AlertThresholds) {
  if (acceptedStars.length < t.minBaselineFrames) return 0

  return median(acceptedStars.slice(-t.baselineFrames))
}

/** The latest frames' median against the same number of frames before them. */
function starsTrend(allStars: number[], t: AlertThresholds) {
  const span = t.baselineFrames

  if (allStars.length < 2 * span) return null

  const recent = median(allStars.slice(-span))
  const before = median(allStars.slice(-2 * span, -span))

  return before >= t.minBaselineStarsForRatios ? { recent, before } : null
}

// ---------------------------------------------------------------------------
// Mount

function watchTracking(readings: MountReading[], t: AlertThresholds): AlertCondition[] {
  let stopped = calm

  for (const reading of readings) {
    const standingStill = reading.tracking === false && reading.slewing === false && reading.parked === false

    stopped = latch(stopped, standingStill, reading.tracking === true, t.trackingStoppedReadings)
  }

  return stopped.raised
    ? [{ id: 'tracking-stopped', level: 'critical', message: 'The mount has stopped tracking' }]
    : []
}

/**
 * On the pre-meridian (west) pier side the mount stops tracking a fixed hour
 * angle past the meridian. After a flip (east) there is nothing to watch.
 */
function watchMeridian(reading: MountReading | undefined, t: AlertThresholds) {
  if (!reading) return meridianUnavailable(['mount readings'])

  const { siderealTimeHours, rightAscensionHours, pierSide } = reading

  if (siderealTimeHours === null || rightAscensionHours === null || pierSide === null) {
    const wanted: Array<[string, unknown]> = [
      ['sidereal time', siderealTimeHours],
      ['right ascension', rightAscensionHours],
      ['pier side', pierSide],
    ]

    const missing = wanted.flatMap(([name, value]) => (value === null ? [name] : []))

    return meridianUnavailable(missing)
  }

  if (pierSide === 'east') return { conditions: [], unavailable: [] }

  const hourAngle = wrapHours(siderealTimeHours - rightAscensionHours)
  const minutesToStop = (t.meridianTrackLimitHours - hourAngle) * 60
  const conditions: AlertCondition[] = []

  if (minutesToStop <= t.meridianNearMinutes) {
    const minutes = Math.max(0, Math.round(minutesToStop))

    conditions.push({ id: 'meridian-near', level: 'warn', message: `Tracking stops in about ${minutes} min at the meridian; re-slew or flip` })
  }

  if (minutesToStop <= t.meridianImminentMinutes) {
    const message = minutesToStop > 0
      ? `Tracking stops in about ${Math.round(minutesToStop)} min at the meridian; re-slew or flip now`
      : 'The mount is at its meridian tracking limit; re-slew or flip now'

    conditions.push({ id: 'meridian-imminent', level: 'critical', message })
  }

  return { conditions, unavailable: [] }
}

function meridianUnavailable(missing: string[]) {
  return { conditions: [], unavailable: [`meridian watch unavailable: ${missing.join(', ')}`] }
}

// ---------------------------------------------------------------------------
// The run itself

function watchReachability(interruptedSince: number | null, t: AlertThresholds, now: number): AlertCondition[] {
  if (interruptedSince === null) return []

  const seconds = (now - interruptedSince) / 1000

  return seconds > t.rigUnreachableSeconds
    ? [{ id: 'rig-unreachable', level: 'critical', message: `The rig has not answered for ${Math.round(seconds)} s` }]
    : []
}

function watchFrameArrival(run: Extract<RunState, { status: 'running' }>, t: AlertThresholds, now: number): AlertCondition[] {
  const allowedSeconds = 2 * (run.exposureSeconds + t.framesStalledGraceSeconds)
  const waitedSeconds = (now - run.waitingForFrameSince) / 1000

  return waitedSeconds > allowedSeconds
    ? [{ id: 'frames-stalled', level: 'warn', message: `No frame for ${Math.round(waitedSeconds / 60)} min (exposures are ${run.exposureSeconds} s)` }]
    : []
}

// ---------------------------------------------------------------------------
// Shared pieces

interface Latch {
  raised: boolean
  streak: number
}

const calm: Latch = { raised: false, streak: 0 }

/**
 * Raises after `toRaise` trips in a row and, once raised, clears after
 * `toClear` clears in a row. Anything between the two thresholds keeps the
 * state but breaks the streak.
 */
function latch(previous: Latch, trips: boolean, clears: boolean, toRaise: number, toClear = 1): Latch {
  if (!previous.raised) {
    const streak = trips ? previous.streak + 1 : 0

    return streak >= toRaise ? { raised: true, streak: 0 } : { raised: false, streak }
  }

  const streak = clears ? previous.streak + 1 : 0

  return streak >= toClear ? calm : { raised: true, streak }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/** Wraps an hour angle into [-12, 12). */
export function wrapHours(hours: number) {
  return ((((hours + 12) % 24) + 24) % 24) - 12
}
