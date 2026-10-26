import { replayAlerts, type AlertEpisode, type FrameAlertId, type ReplayOptions } from './alerts.ts'
import type { LabelWindow, NightLabels } from './labels.ts'
import type { Run } from './runs.ts'

/** What happened in one labelled window. Only an alert's start decides which window it belongs to. */
export interface WindowAssessment {
  window: LabelWindow
  /** Each alert the window needs, with the episode that met it, or null when it never started. */
  required: Array<{ id: FrameAlertId; episode: AlertEpisode | null }>
  /** Episodes that started in the window and are neither required nor allowed. */
  unexpected: AlertEpisode[]
  /** Episodes that started in the window and are allowed. */
  allowed: AlertEpisode[]
}

export interface NightAssessment {
  labels: NightLabels
  /** Null when no run of the label's target and exposure overlaps its windows. That is a failure, never a pass. */
  run: Run | null
  windows: WindowAssessment[]
  /** Episodes that started in no window, so nothing said they were fine. */
  unlabelled: AlertEpisode[]
  passed: boolean
}

/** The run the labels describe: the same target and exposure, overlapping the span the windows cover. */
export function runOfNight(labels: NightLabels, runs: Run[]) {
  const from = labels.windows[0]!.from
  const to = labels.windows.at(-1)!.to

  return runs.find(
    run =>
      run.target === labels.target &&
      run.exposureSeconds === labels.exposureSeconds &&
      run.frames[0]!.capturedAt <= to &&
      run.frames.at(-1)!.capturedAt >= from,
  ) ?? null
}

export function assessNight(labels: NightLabels, runs: Run[], options: ReplayOptions): NightAssessment {
  const run = runOfNight(labels, runs)

  if (!run) return { labels, run, windows: [], unlabelled: [], passed: false }

  const episodes = replayAlerts(run, options)
  const within = (window: LabelWindow) => episodes.filter(episode => episode.from >= window.from && episode.from <= window.to)

  const windows = labels.windows.map((window): WindowAssessment => {
    const started = within(window)

    if (window.kind === 'healthy') return { window, required: [], unexpected: started, allowed: [] }

    if (window.kind === 'transition') {
      return {
        window,
        required: [],
        unexpected: started.filter(episode => !window.allow.includes(episode.id)),
        allowed: started.filter(episode => window.allow.includes(episode.id)),
      }
    }

    return {
      window,
      required: window.expect.map(id => ({ id, episode: started.find(episode => episode.id === id) ?? null })),
      unexpected: started.filter(episode => !window.expect.includes(episode.id)),
      allowed: [],
    }
  })

  const unlabelled = episodes.filter(episode => !labels.windows.some(window => episode.from >= window.from && episode.from <= window.to))

  const passed =
    unlabelled.length === 0 &&
    windows.every(({ required, unexpected }) => unexpected.length === 0 && required.every(({ episode }) => episode !== null))

  return { labels, run, windows, unlabelled, passed }
}

/** Whether the night holds for one alert alone: it is raised where it is needed and nowhere it is not. */
export function passedFor(night: NightAssessment, id: FrameAlertId) {
  if (!night.run) return false

  return (
    night.unlabelled.every(episode => episode.id !== id) &&
    night.windows.every(
      ({ required, unexpected }) =>
        unexpected.every(episode => episode.id !== id) &&
        required.every(need => need.id !== id || need.episode !== null),
    )
  )
}
