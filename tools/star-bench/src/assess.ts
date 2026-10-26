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
  /** Frames of the matched runs inside the window. A window with none judged nothing, so it fails. */
  frames: number
}

export interface NightAssessment {
  labels: NightLabels
  /** Every run of the label's target and exposure that overlaps its windows, each replayed with its own history. None is a failure, never a pass. */
  runs: Run[]
  windows: WindowAssessment[]
  /** Episodes that started in no window, so nothing said they were fine. */
  unlabelled: AlertEpisode[]
  passed: boolean
}

/** The runs the labels describe: the same target and exposure, overlapping the span the windows cover. A reset splits a night into several. */
export function runsOfNight(labels: NightLabels, runs: Run[]) {
  const from = labels.windows[0]!.from
  const to = labels.windows.at(-1)!.to

  return runs.filter(
    run =>
      run.target === labels.target &&
      run.exposureSeconds === labels.exposureSeconds &&
      run.frames[0]!.capturedAt <= to &&
      run.frames.at(-1)!.capturedAt >= from,
  )
}

export function assessNight(labels: NightLabels, runs: Run[], options: ReplayOptions): NightAssessment {
  const matched = runsOfNight(labels, runs)

  if (matched.length === 0) return { labels, runs: matched, windows: [], unlabelled: [], passed: false }

  const episodes = matched.flatMap(run => replayAlerts(run, options)).sort((a, b) => a.from - b.from)
  const inWindow = (window: LabelWindow, at: number) => at >= window.from && at <= window.to

  const framesIn = (window: LabelWindow) =>
    matched.flatMap(run => run.frames).filter(frame => inWindow(window, frame.capturedAt)).length

  const within = (window: LabelWindow) => episodes.filter(episode => inWindow(window, episode.from))

  const windows = labels.windows.map((window): WindowAssessment => {
    const started = within(window)

    if (window.kind === 'healthy') return { window, required: [], unexpected: started, allowed: [], frames: framesIn(window) }

    if (window.kind === 'transition') {
      return {
        window,
        required: [],
        unexpected: started.filter(episode => !window.allow.includes(episode.id)),
        allowed: started.filter(episode => window.allow.includes(episode.id)),
        frames: framesIn(window),
      }
    }

    return {
      window,
      required: window.expect.map(id => ({ id, episode: started.find(episode => episode.id === id) ?? null })),
      unexpected: started.filter(episode => !window.expect.includes(episode.id)),
      allowed: [],
      frames: framesIn(window),
    }
  })

  const unlabelled = episodes.filter(episode => !labels.windows.some(window => episode.from >= window.from && episode.from <= window.to))

  const passed =
    unlabelled.length === 0 &&
    windows.every(({ required, unexpected, frames }) => frames > 0 && unexpected.length === 0 && required.every(({ episode }) => episode !== null))

  return { labels, runs: matched, windows, unlabelled, passed }
}

/** Whether the night holds for one alert alone: it is raised where it is needed and nowhere it is not. */
export function passedFor(night: NightAssessment, id: FrameAlertId) {
  if (night.runs.length === 0) return false

  return (
    night.unlabelled.every(episode => episode.id !== id) &&
    night.windows.every(
      ({ required, unexpected, frames }) =>
        frames > 0 &&
        unexpected.every(episode => episode.id !== id) &&
        required.every(need => need.id !== id || need.episode !== null),
    )
  )
}
