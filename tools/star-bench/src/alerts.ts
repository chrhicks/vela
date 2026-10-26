import { alertCountInput, alertFrame, type AlertCountInput } from '@vela/server/alerts/frame'
import { evaluateAlerts, type AlertId, type Frame } from '@vela/server/alerts/rules'
import { defaultThresholds, type AlertThresholds } from '@vela/server/alerts/thresholds'
import type { Run } from './runs.ts'

/** The conditions that read only the frames' star count and HFR. The others need a mount or a clock. */
export const frameAlertIds = [
  'no-stars',
  'stars-dropping',
  'stars-collapsed',
  'stars-declining',
  'hfr-high',
  'hfr-bad',
] as const satisfies readonly AlertId[]

export type FrameAlertId = (typeof frameAlertIds)[number]

function isFrameAlert(id: AlertId): id is FrameAlertId {
  return frameAlertIds.some(known => known === id)
}

/** A frame-derived alert that stood from one frame to the next. Times are epoch milliseconds. */
export interface AlertEpisode {
  id: FrameAlertId
  from: number
  /** The capture time of the frame that cleared it, or null while it still stood at the last frame. */
  until: number | null
  /** What the alert said on the frame that raised it. */
  message: string
}

/** The star count the alerts read and the thresholds they use. The defaults are what Vela ships. */
export interface ReplayOptions {
  count: AlertCountInput
  thresholds: AlertThresholds
}

export const shippedReplay: ReplayOptions = { count: alertCountInput, thresholds: defaultThresholds }

/** The frames the monitor would hold for this run: the ones whose statistics give an alert frame. */
export function alertFrames(run: Run, count: AlertCountInput): Frame[] {
  return run.statistics.flatMap((statistics, index) => {
    const frame = alertFrame(run.frames[index]!.capturedAt, statistics, count)

    return frame ? [frame] : []
  })
}

/** Feeds a run's frames in order through Vela's real `evaluateAlerts`, as the monitor does. */
export function replayAlerts(run: Run, options: ReplayOptions = shippedReplay): AlertEpisode[] {
  const episodes: AlertEpisode[] = []
  const standing = new Map<FrameAlertId, AlertEpisode>()
  const frames = alertFrames(run, options.count)

  for (const [index, frame] of frames.entries()) {
    const evaluation = evaluateAlerts(
      {
        run: {
          status: 'running',
          exposureSeconds: run.exposureSeconds,
          waitingForFrameSince: frame.capturedAt,
          imaging: true,
        },
        frames: frames.slice(0, index + 1),
        mountReadings: [],
        observationsInterruptedSince: null,
      },
      options.thresholds,
      frame.capturedAt,
    )

    const now = new Map<FrameAlertId, string>()

    for (const { id, message } of evaluation.conditions) if (isFrameAlert(id)) now.set(id, message)

    for (const [id, message] of now) {
      if (standing.has(id)) continue
      const episode: AlertEpisode = { id, from: frame.capturedAt, until: null, message }
      standing.set(id, episode)
      episodes.push(episode)
    }

    for (const [id, episode] of standing) {
      if (now.has(id)) continue
      episode.until = frame.capturedAt
      standing.delete(id)
    }
  }

  return episodes
}
