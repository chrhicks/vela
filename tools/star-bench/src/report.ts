import { replayAlerts, type ReplayOptions } from './alerts.ts'
import { assessNight, type NightAssessment } from './assess.ts'
import type { FrameResult } from './compare.ts'
import type { SkippedDirectory } from './frames.ts'
import type { NightLabels } from './labels.ts'
import { groupRuns, type Run } from './runs.ts'
import { jumpFactor, median, steadiness } from './steadiness.ts'
import { sweeps, sweepThreshold, type SweepRange } from './sweep.ts'

/** The first-failed-gate reasons in the order the gates run. */
const rejections = ['blended', 'edge', 'unconverged', 'faint', 'saturated', 'wings', 'elongated', 'floor'] as const

const namedOutputColumns = 3 + rejections.length + 3

/** A frame whose strong stars read at least this elongated is flagged in the report. */
const elongatedAxisRatio = 1.3

/** One row per frame, tab separated. It holds no timings, so two runs of the same code are identical. */
export function renderTable(results: FrameResult[]) {
  const header = [
    'frame',
    'captured_at',
    'frame_type',
    'target',
    'exposure_seconds',
    'detected_stars',
    'median_hfr_pixels',
    'recorded_detected_stars',
    'recorded_median_hfr_pixels',
    'comparison',
    'detections',
    'measured',
    'strong',
    ...rejections.map(reason => `rejected_${reason}`),
    'sky_level',
    'sky_noise',
    'axis_ratio',
  ]

  const rows = results.map(({ frame, measurement, comparison }) => [
    frame.id,
    new Date(frame.capturedAt).toISOString(),
    frame.frameType,
    frame.target ?? '',
    String(frame.exposureSeconds),
    measurement.status === 'measured' ? String(measurement.detectedStars) : '',
    measurement.status === 'measured' ? String(measurement.medianHfrPixels ?? '') : '',
    String(frame.recorded?.detectedStars ?? ''),
    String(frame.recorded?.medianHfrPixels ?? ''),
    comparison.status,
    ...(measurement.status === 'measured'
      ? [
          measurement.detections,
          measurement.measured,
          measurement.strong,
          ...rejections.map(reason => measurement.rejected[reason]),
          measurement.sky,
          measurement.noise,
          measurement.axisRatio ?? '',
        ].map(String)
      : Array(namedOutputColumns).fill('')),
  ])

  return [header, ...rows].map(row => row.join('\t')).join('\n') + '\n'
}

const listedFrames = 10

/** What the report replays and checks beyond the comparison with the records. */
export interface ReportOptions {
  gapMinutes: number
  restartTimes: number[]
  replay: ReplayOptions
  /** Labelled nights to check the alerts against, or null for a report without that section. */
  labels: NightLabels[] | null
  /** Also find how far each star threshold can move before a labelled night fails. Slow. */
  sweep: boolean
}

export function renderReport(results: FrameResult[], skipped: SkippedDirectory[], options: ReportOptions) {
  const runs = groupRuns(results, options.gapMinutes, options.restartTimes)

  const lines = [
    ...renderComparison(results, skipped),
    '',
    ...renderRuns(results, runs, options),
    ...(options.labels ? ['', ...renderLabelled(runs, options.labels, options)] : []),
  ]

  return lines.join('\n') + '\n'
}

function renderComparison(results: FrameResult[], skipped: SkippedDirectory[]) {
  const withStatus = (status: FrameResult['comparison']['status']) =>
    results.filter(result => result.comparison.status === status)

  const lines = [
    `${withStatus('match').length} of ${results.length} frames match the recorded statistics.`,
    `  differ ${withStatus('differ').length}, unrecorded ${withStatus('unrecorded').length}, not measured ${withStatus('failed').length}`,
  ]

  const hfrDifferences = results.flatMap(({ comparison }) =>
    comparison.status === 'differ' && comparison.hfrDifferencePixels !== null
      ? [comparison.hfrDifferencePixels]
      : [],
  )

  if (hfrDifferences.length)
    lines.push(`  largest HFR difference ${Math.max(...hfrDifferences).toFixed(4)} px`)

  for (const { frame, comparison } of withStatus('differ').slice(0, listedFrames)) {
    if (comparison.status === 'differ') lines.push(`  differ ${frame.id}: ${comparison.differences.join(', ')}`)
  }

  for (const { frame, comparison } of withStatus('failed').slice(0, listedFrames)) {
    if (comparison.status === 'failed') lines.push(`  not measured ${frame.id}: ${comparison.reason}`)
  }

  if (skipped.length) lines.push(`  ${skipped.length} directories skipped, first: ${skipped[0]!.reason}`)

  return lines
}

function renderRuns(results: FrameResult[], runs: Run[], { gapMinutes, restartTimes, replay }: ReportOptions) {
  const restarts = restartTimes.map(restart => `, or at ${time(restart)}`).join('')
  const lines = [`Light-frame runs (same target and exposure, a new run after a gap over ${gapMinutes} min${restarts})`]

  for (const run of runs) {
    const first = run.frames[0]!
    const last = run.frames.at(-1)!
    const episodes = replayAlerts(run, replay)

    lines.push(
      `${run.target}, ${run.exposureSeconds} s: ${run.frames.length} frames, ${time(first.capturedAt)} to ${time(last.capturedAt)}`,
      `  stars median ${median(run.frames.map(frame => frame.stars))}, ${steadinessLine(run.frames.map(frame => frame.stars))}`,
      `  strong stars median ${medianOf(run, 'strong')}, ${steadinessLine(run.statistics.map(statistics => statistics.strong))}`,
      `  per frame, median: peaks ${medianOf(run, 'detections')}, measured ${medianOf(run, 'measured')}, strong ${medianOf(run, 'strong')}, sky ${medianOf(run, 'sky')}, noise ${medianOf(run, 'noise')}`,
      `  axis ratio of strong stars: ${axisRatioLine(run)}`,
      `  rejected by first failed gate, median: ${rejections.map(reason => `${reason} ${median(run.statistics.map(statistics => statistics.rejected[reason]))}`).join(', ')}`,
    )

    if (episodes.length === 0) lines.push('  alerts none')

    for (const episode of episodes)
      lines.push(`  alert ${episode.id} ${time(episode.from)} to ${episode.until === null ? 'end of run' : time(episode.until)}`)
  }

  const outside = results.filter(
    ({ frame, measurement }) => frame.frameType !== 'light' || measurement.status !== 'measured',
  )

  lines.push(`Frames outside any run: ${outside.length}${describeTypes(outside)}`)

  return lines
}

function steadinessLine(counts: number[]) {
  const { pairs, jumps, spread } = steadiness(counts)

  return `spread ${spread === null ? 'n/a' : spread.toFixed(3)}, ${jumps} of ${pairs} pairs jump over ${jumpFactor}x`
}

/** The frames with a recorded axis ratio, and how many of them read over `elongatedAxisRatio`. */
function axisRatioLine(run: Run) {
  const ratios = run.statistics.flatMap(({ axisRatio }) => (axisRatio === null ? [] : [axisRatio]))

  if (ratios.length === 0) return `none recorded in ${run.frames.length} frames`
  const elongated = ratios.filter(ratio => ratio > elongatedAxisRatio).length

  return `${ratios.length} of ${run.frames.length} frames, median ${median(ratios).toFixed(3)}, ${elongated} over ${elongatedAxisRatio}`
}

function medianOf(run: Run, name: 'detections' | 'measured' | 'strong' | 'sky' | 'noise') {
  return Number(median(run.statistics.map(statistics => statistics[name])).toPrecision(4))
}

function describeTypes(results: FrameResult[]) {
  const counts = new Map<string, number>()

  for (const { frame } of results) counts.set(frame.frameType, (counts.get(frame.frameType) ?? 0) + 1)

  return counts.size ? ` (${[...counts].map(([type, count]) => `${type} ${count}`).join(', ')})` : ''
}

function time(epochMilliseconds: number) {
  return `${new Date(epochMilliseconds).toISOString().slice(0, 19)}Z`
}

function renderLabelled(runs: Run[], labels: NightLabels[], { replay, sweep }: ReportOptions) {
  const nights = labels.map(night => assessNight(night, runs, replay))
  const lines = [`Labelled nights (alert count: ${replay.count})`]

  for (const night of nights) lines.push(...renderNight(night))

  const labelled = new Set(nights.flatMap(night => night.runs))
  const unlabelled = runs.filter(run => !labelled.has(run))

  if (unlabelled.length)
    lines.push(`Runs without labels: ${unlabelled.map(run => `${run.target}, ${run.exposureSeconds} s from ${time(run.frames[0]!.capturedAt)}`).join('; ')}`)

  lines.push(...renderSummary(nights))

  if (sweep) lines.push('', ...renderSweep(nights.map(night => night.labels), runs, replay))

  return lines
}

function renderNight({ labels, runs, windows, unlabelled, passed }: NightAssessment) {
  const lines = [`${labels.night}, ${labels.exposureSeconds} s, ${labels.use}: ${passed ? 'pass' : 'FAIL'}`]

  if (runs.length === 0) return [...lines, `  NO RUN: no ${labels.target} run of ${labels.exposureSeconds} s overlaps the labelled windows`]

  for (const { window, required, unexpected, allowed, frames } of windows) {
    const name = window.kind === 'event' ? `event ${window.name}` : window.kind
    const span = `${time(window.from)} to ${time(window.to)}`
    const quiet = unexpected.length === 0 && allowed.length === 0 && required.length === 0

    lines.push(`  ${name} ${span}${frames === 0 ? ': NO FRAMES' : quiet ? ': quiet' : ''}`)

    for (const { id, episode } of required) {
      if (!episode) lines.push(`    ${id} NOT RAISED`)
      else lines.push(`    ${id} raised ${time(episode.from)} (+${minutesAfter(episode.from, window.from)} min), ${cleared(episode.until)}: ${episode.message}`)
    }

    for (const episode of allowed) lines.push(`    allowed ${episode.id} raised ${time(episode.from)}, ${cleared(episode.until)}: ${episode.message}`)

    for (const episode of unexpected) lines.push(`    UNEXPECTED ${episode.id} raised ${time(episode.from)}, ${cleared(episode.until)}: ${episode.message}`)
  }

  for (const episode of unlabelled) lines.push(`  UNLABELLED ${episode.id} raised ${time(episode.from)}, ${cleared(episode.until)}: ${episode.message}`)

  return lines
}

function renderSummary(nights: NightAssessment[]) {
  const lines: string[] = []

  for (const use of ['calibration', 'holdout'] as const) {
    const chosen = nights.filter(night => night.labels.use === use)
    const required = chosen.flatMap(night => night.windows.flatMap(({ required }) => required))
    const raised = required.filter(({ episode }) => episode !== null).length
    const unexpected = chosen.reduce((sum, night) => sum + night.windows.reduce((count, { unexpected }) => count + unexpected.length, 0) + night.unlabelled.length, 0)

    lines.push(`${use === 'holdout' ? 'Held out' : 'Calibration'}: ${chosen.filter(night => night.passed).length} of ${chosen.length} nights pass, ${raised} of ${required.length} expected alerts raised, ${unexpected} unexpected`)
  }

  return lines
}

function renderSweep(labels: NightLabels[], runs: Run[], replay: ReplayOptions) {
  const lines = ['Threshold ranges: the values at which the alert it governs passes every labelled night of that kind, in steps of 0.01 (the margins are from the default to each end; * means the end of the values tried)']

  for (const spec of sweeps) {
    const result = sweepThreshold(labels, runs, spec, replay)

    lines.push(`  ${spec.threshold} default ${result.default}: calibration ${range(result.calibration, result.default)}, held out ${range(result.holdout, result.default)}, both ${range(result.both, result.default)}`)
  }

  return lines
}

function range(found: SweepRange | null, centre: number) {
  if (!found) return 'none'
  const span = `${found.lowest.toFixed(2)}${found.openBelow ? '*' : ''} to ${found.highest.toFixed(2)}${found.openAbove ? '*' : ''}`

  return found.holdsAtDefault
    ? `${span} (-${(centre - found.lowest).toFixed(2)} / +${(found.highest - centre).toFixed(2)})`
    : `${span}, not the default`
}

function minutesAfter(at: number, start: number) {
  return ((at - start) / 60_000).toFixed(1)
}

function cleared(until: number | null) {
  return until === null ? 'still standing at the end of the run' : `cleared ${time(until)}`
}
