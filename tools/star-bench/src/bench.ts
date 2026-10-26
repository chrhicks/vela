import type { AlertCountInput } from '@vela/server/alerts/frame'
import { shippedReplay } from './alerts.ts'
import { compareStatistics, type FrameResult } from './compare.ts'
import { readCatalog, selectListedFrames } from './frames.ts'
import { readLabels } from './labels.ts'
import { measureFrames } from './measure.ts'
import { renderReport, renderTable } from './report.ts'
import { median } from './steadiness.ts'

export interface BenchOptions {
  savedImages: string
  listFile: string | null
  jobs: number
  gapMinutes: number
  /** Times the alert monitor would have started its history over, such as the end of an autofocus. */
  restartTimes: number[]
  /** The star count the alert replay reads. */
  count: AlertCountInput
  /** A directory of per-night label files to check the alerts against, or null. */
  labelsDirectory: string | null
  /** Find the range each star threshold can move through. Slow. */
  sweep: boolean
}

export interface BenchResult {
  report: string
  table: string
  /** True when every frame measured and equals its record. */
  allMatch: boolean
  /** How long measuring took. Kept apart from the report so the report is repeatable. */
  timing: { frames: number; elapsedSeconds: number; medianFrameSeconds: number | null }
}

/** Measures saved frames with Vela's own code and sets the result beside what Vela recorded. */
export async function runBench(
  options: BenchOptions,
  onMeasured: (done: number, total: number) => void = () => {},
): Promise<BenchResult> {
  const labels = options.labelsDirectory === null ? null : await readLabels(options.labelsDirectory)
  const catalog = await readCatalog(options.savedImages)

  const frames = options.listFile === null
    ? catalog.frames
    : await selectListedFrames(catalog, options.listFile)

  const started = performance.now()

  const measurements = await measureFrames(
    frames.map(frame => frame.directory),
    options.jobs,
    done => onMeasured(done, frames.length),
  )

  const elapsedSeconds = (performance.now() - started) / 1000

  const results: FrameResult[] = frames.map((frame, index) => ({
    frame,
    measurement: measurements[index]!,
    comparison: compareStatistics(measurements[index]!, frame.recorded),
  }))

  const seconds = measurements.flatMap(measurement =>
    measurement.status === 'measured' ? [measurement.milliseconds / 1000] : [],
  )

  return {
    report: renderReport(results, catalog.skipped, {
      gapMinutes: options.gapMinutes,
      restartTimes: options.restartTimes,
      replay: { ...shippedReplay, count: options.count },
      labels,
      sweep: options.sweep,
    }),
    table: renderTable(results),
    allMatch: results.length > 0 && results.every(result => result.comparison.status === 'match'),
    timing: {
      frames: results.length,
      elapsedSeconds,
      medianFrameSeconds: seconds.length ? median(seconds) : null,
    },
  }
}
