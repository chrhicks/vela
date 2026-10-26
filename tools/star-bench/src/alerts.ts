import { evaluateAlerts, type AlertId } from '@vela/server/alerts/rules'
import { defaultThresholds } from '@vela/server/alerts/thresholds'
import type { Run } from './runs.ts'

/** The conditions that read only the frames' star count and HFR. The others need a mount or a clock. */
const frameAlerts = new Set<AlertId>([
  'no-stars',
  'stars-dropping',
  'stars-collapsed',
  'stars-declining',
  'hfr-high',
  'hfr-bad',
])

/** A frame-derived alert that stood from one frame to the next. Times are epoch milliseconds. */
export interface AlertEpisode {
  id: AlertId
  from: number
  /** The capture time of the frame that cleared it, or null while it still stood at the last frame. */
  until: number | null
}

/** Feeds a run's frames in order through Vela's real `evaluateAlerts`, as the monitor does. */
export function replayAlerts(run: Run): AlertEpisode[] {
  const episodes: AlertEpisode[] = []
  const standing = new Map<AlertId, AlertEpisode>()

  for (const [index, frame] of run.frames.entries()) {
    const evaluation = evaluateAlerts(
      {
        run: {
          status: 'running',
          exposureSeconds: run.exposureSeconds,
          waitingForFrameSince: frame.capturedAt,
          imaging: true,
        },
        frames: run.frames.slice(0, index + 1),
        mountReadings: [],
        observationsInterruptedSince: null,
      },
      defaultThresholds,
      frame.capturedAt,
    )

    const now = new Set(
      evaluation.conditions.map(condition => condition.id).filter(id => frameAlerts.has(id)),
    )

    for (const id of now) {
      if (standing.has(id)) continue
      const episode: AlertEpisode = { id, from: frame.capturedAt, until: null }
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
