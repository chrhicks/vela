import type { AlertThresholds } from './thresholds.js'

export type AlertLevel = 'warn' | 'critical'

export type AlertId =
  | 'no-stars'
  | 'stars-dropping'
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
  | 'run-interrupted'

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
  | { status: 'running'; exposureSeconds: number; waitingForFrameSince: number; imaging: boolean }
  | { status: 'stopped' }
  | { status: 'failed' }
  /** The server restarted while the run was active; `message` says how far it got. */
  | { status: 'interrupted'; message: string }

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

  if (run.status === 'interrupted')
    return { conditions: [{ id: 'run-interrupted', level: 'critical', message: run.message }], unavailable: [] }

  if (run.status === 'stopped') return { conditions: [], unavailable: [] }

  const meridian = watchMeridian(history.mountReadings.at(-1), thresholds)
  const frames = watchFrames(history.frames, thresholds)

  return {
    conditions: [
      ...frames.conditions,
      ...(run.imaging ? watchStarBaseline(history.frames.length, frames.baselineFormed, thresholds) : []),
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
 * Compares the run's star count with itself. One frame is never compared: a count is the median of
 * the last few frames. The baseline is the median of the last accepted frames, and a frame is
 * accepted when neither it nor an alert standing says the sky or camera is off, so a stretch of
 * cloud or a snagged camera never becomes the new normal.
 */
function watchFrames(frames: Frame[], t: AlertThresholds) {
  const acceptedStars: number[] = []
  const smoothed: number[] = []
  let starsDropping = calm
  let starsCollapsed = calm
  let starsDeclining = calm
  let hfrHigh = calm
  let hfrBad = calm
  let baseline = 0
  let baselineFormed = false
  let trendFrom = 0

  for (const [index, frame] of frames.entries()) {
    baseline = baselineStars(acceptedStars, t)
    baselineFormed ||= hasStars(baseline, t)
    smoothed.push(smoothedStars(frames, index, t))

    const stars = smoothed[index]!
    const hfr = frame.hfrPixels
    const trend = starsTrend(frames, trendFrom, index, t)
    const canCompare = baseline >= t.minBaselineStarsForRatios
    const empty = frame.stars === 0 && baseline >= t.minBaselineStarsForEmptyFrame
    const dropping = starsFell(frames, smoothed, index, t)
    const collapsed = empty || (canCompare && stars < t.starsCollapsedRatio * baseline)
    const recovered = stars >= t.starsRecoveredRatio * baseline

    // A drop or collapse is a break in the sky or the camera, not a slope: the trend starts over
    // after it, so a haze that has passed is not reported again as a decline.
    if (dropping || collapsed) trendFrom = index + 1

    starsDropping = latch(starsDropping, dropping, recovered, t.confirmFrames, t.confirmFrames)
    starsCollapsed = latch(starsCollapsed, collapsed, recovered, t.confirmFrames, t.confirmFrames)
    starsDeclining = latch(
      starsDeclining,
      trend !== null && trend.recent < t.starsDecliningRatio * trend.before,
      trend === null || trend.recent >= t.starsDecliningClearRatio * trend.before,
      1,
    )
    hfrHigh = latch(hfrHigh, hfr !== null && hfr > t.hfrHighPixels, hfr !== null && hfr < t.hfrHighClearPixels, t.confirmFrames)
    hfrBad = latch(hfrBad, hfr !== null && hfr > t.hfrBadPixels, hfr !== null && hfr < t.hfrBadClearPixels, t.confirmFrames)

    const bad = dropping || collapsed || (hfr !== null && hfr > t.hfrHighPixels)

    const inEpisode =
      starsDropping.raised || starsCollapsed.raised || starsDeclining.raised || hfrHigh.raised || hfrBad.raised

    if (!bad && !inEpisode) acceptedStars.push(frame.stars)
  }

  const latest = frames.at(-1)

  if (!latest) return { conditions: [], baselineFormed }

  baselineFormed ||= hasStars(baselineStars(acceptedStars, t), t)

  const trend = starsTrend(frames, trendFrom, frames.length - 1, t)
  const median = Math.round(smoothed.at(-1)!)
  const normal = `normal ≈${Math.round(baseline)} stars`
  const hfr = latest.hfrPixels?.toFixed(1)
  const conditions: AlertCondition[] = []

  if (starsDropping.raised)
    conditions.push({ id: 'stars-dropping', level: 'warn', message: `Star count dropping: median ${median} (${normal})` })

  if (starsCollapsed.raised)
    conditions.push({ id: 'stars-collapsed', level: 'critical', message: `Star count fell to ${latest.stars} (median ${median}, ${normal})` })

  if (starsDeclining.raised && trend)
    conditions.push({ id: 'stars-declining', level: 'warn', message: `Star count falling: median ${Math.round(trend.recent)} (≈${Math.round(trend.before)} the ${t.starsDecliningWindowMinutes} min before)` })

  if (hfrHigh.raised)
    conditions.push({ id: 'hfr-high', level: 'warn', message: `Stars are soft: HFR ${hfr ?? 'unmeasured'} px` })

  if (hfrBad.raised)
    conditions.push({ id: 'hfr-bad', level: 'critical', message: `Stars are badly out of focus: HFR ${hfr ?? 'unmeasured'} px` })

  return { conditions, baselineFormed }
}

/**
 * Below `minBaselineStarsForEmptyFrame` stars no star alert can fire, so a baseline that is that
 * thin is no baseline. A run that has none after `noStarsFrames` frames (cap on, cloud from the
 * start, far out of focus, the wrong target) would otherwise be silent all night. Once a baseline
 * has formed, a later loss of stars is the star alerts' to report, so this one clears for good.
 */
function watchStarBaseline(frameCount: number, baselineFormed: boolean, t: AlertThresholds): AlertCondition[] {
  if (baselineFormed || frameCount < t.noStarsFrames) return []

  return [{ id: 'no-stars', level: 'critical', message: `No stars after ${t.noStarsFrames} frames` }]
}

function hasStars(baseline: number, t: AlertThresholds) {
  return baseline >= t.minBaselineStarsForEmptyFrame
}

/** Median of the last accepted frames, or 0 until there are enough to trust. */
function baselineStars(acceptedStars: number[], t: AlertThresholds) {
  if (acceptedStars.length < t.minBaselineFrames) return 0

  return median(acceptedStars.slice(-t.baselineFrames))
}

/** The median star count of the frame at `index` and the frames just before it. */
function smoothedStars(frames: Frame[], index: number, t: AlertThresholds) {
  return median(frames.slice(Math.max(0, index - t.starsSmoothingFrames + 1), index + 1).map(frame => frame.stars))
}

/**
 * Whether the smoothed count at frame `index` has fallen below its allowed share of the highest
 * smoothed count within the drop window before it. Smoothing needs a full set of frames, so the
 * first frames of a history are neither the fall nor what it fell from.
 */
function starsFell(frames: Frame[], smoothed: number[], index: number, t: AlertThresholds) {
  const firstSmoothed = t.starsSmoothingFrames - 1

  if (index <= firstSmoothed) return false

  const windowStart = frames[index]!.capturedAt - t.starsDropWindowMinutes * 60_000
  let peak = 0

  for (let earlier = firstSmoothed; earlier < index; earlier++)
    if (frames[earlier]!.capturedAt >= windowStart) peak = Math.max(peak, smoothed[earlier]!)

  return peak >= t.minBaselineStarsForRatios && smoothed[index]! < (1 - t.starsDropFraction) * peak
}

/**
 * The median star count of the last `starsDecliningWindowMinutes` against the same time before
 * it. Time, not frame count, so the trend means the same at 30 s and 180 s exposures.
 */
function starsTrend(frames: Frame[], from: number, index: number, t: AlertThresholds) {
  const spanMs = t.starsDecliningWindowMinutes * 60_000
  const now = frames[index]!.capturedAt
  const recent: number[] = []
  const before: number[] = []

  for (const frame of frames.slice(from, index + 1)) {
    const age = now - frame.capturedAt

    if (age < spanMs) recent.push(frame.stars)
    else if (age < 2 * spanMs) before.push(frame.stars)
  }

  if (recent.length < t.minBaselineFrames || before.length < t.minBaselineFrames) return null

  const trend = { recent: median(recent), before: median(before) }

  return trend.before >= t.minBaselineStarsForRatios ? trend : null
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
