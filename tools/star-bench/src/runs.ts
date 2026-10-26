import type { Frame } from '@vela/server/alerts/rules'
import type { FrameResult } from './compare.ts'
import type { StarStatistics } from './measure.ts'

/** Light frames of one target and exposure, as the alert monitor would see them in one run. */
export interface Run {
  target: string
  exposureSeconds: number
  frames: Frame[]
  /** Each frame's full measurement, in the order of `frames`. */
  statistics: StarStatistics[]
}

/**
 * Starts a new run at a change of target or exposure, after a gap longer than `gapMinutes`, or
 * when a time in `restartTimes` falls between two frames. The monitor also starts its history over
 * when autofocus ends. The bench has no focuser log, so the caller names those times.
 */
export function groupRuns(results: FrameResult[], gapMinutes: number, restartTimes: number[] = []): Run[] {
  const runs: Run[] = []
  const open = new Map<string, Run>()

  const inOrder = [...results].sort((a, b) => a.frame.capturedAt - b.frame.capturedAt)

  for (const { frame, measurement } of inOrder) {
    if (frame.frameType !== 'light' || measurement.status !== 'measured') continue
    const target = frame.target ?? '(no target)'
    const key = `${target}\t${frame.exposureSeconds}`
    let run = open.get(key)
    const last = run?.frames.at(-1)

    const restarted =
      last !== undefined &&
      (frame.capturedAt - last.capturedAt > gapMinutes * 60_000 ||
        restartTimes.some(time => last.capturedAt < time && time <= frame.capturedAt))

    if (!run || !last || restarted) {
      run = { target, exposureSeconds: frame.exposureSeconds, frames: [], statistics: [] }
      open.set(key, run)
      runs.push(run)
    }

    run.frames.push({
      capturedAt: frame.capturedAt,
      stars: measurement.detectedStars,
      hfrPixels: measurement.medianHfrPixels,
    })
    run.statistics.push(measurement)
  }

  return runs.sort((a, b) => a.frames[0]!.capturedAt - b.frames[0]!.capturedAt)
}
