import { replayAlerts } from './alerts.ts'
import type { FrameResult } from './compare.ts'
import type { SkippedDirectory } from './frames.ts'
import { groupRuns, type Run } from './runs.ts'
import { jumpFactor, median, steadiness } from './steadiness.ts'

/** The first-failed-gate reasons in the order the gates run. */
const rejections = ['blended', 'edge', 'unconverged', 'faint', 'saturated', 'wings', 'elongated', 'floor'] as const

const namedOutputColumns = 3 + rejections.length + 2

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
        ].map(String)
      : Array(namedOutputColumns).fill('')),
  ])

  return [header, ...rows].map(row => row.join('\t')).join('\n') + '\n'
}

const listedFrames = 10

export function renderReport(
  results: FrameResult[],
  skipped: SkippedDirectory[],
  gapMinutes: number,
  restartTimes: number[],
) {
  const lines = [...renderComparison(results, skipped), '', ...renderRuns(results, gapMinutes, restartTimes)]

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

function renderRuns(results: FrameResult[], gapMinutes: number, restartTimes: number[]) {
  const runs = groupRuns(results, gapMinutes, restartTimes)
  const restarts = restartTimes.map(restart => `, or at ${time(restart)}`).join('')
  const lines = [`Light-frame runs (same target and exposure, a new run after a gap over ${gapMinutes} min${restarts})`]

  for (const run of runs) {
    const first = run.frames[0]!
    const last = run.frames.at(-1)!
    const { pairs, jumps, spread } = steadiness(run.frames.map(frame => frame.stars))
    const episodes = replayAlerts(run)

    lines.push(
      `${run.target}, ${run.exposureSeconds} s: ${run.frames.length} frames, ${time(first.capturedAt)} to ${time(last.capturedAt)}`,
      `  stars median ${median(run.frames.map(frame => frame.stars))}, spread ${spread === null ? 'n/a' : spread.toFixed(3)}, ${jumps} of ${pairs} pairs jump over ${jumpFactor}x`,
      `  per frame, median: peaks ${medianOf(run, 'detections')}, measured ${medianOf(run, 'measured')}, strong ${medianOf(run, 'strong')}, sky ${medianOf(run, 'sky')}, noise ${medianOf(run, 'noise')}`,
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
