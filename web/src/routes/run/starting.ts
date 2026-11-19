import type { Autofocus } from '../../../../state/autofocus.ts'
import type { StartStep } from '../../../../state/entries.ts'
import { checkedFrames, framesOf, type FirstFrames } from '../../../../state/first-frames.ts'
import type { FirstFramesLimits } from '../../../../state/first-frames-check.ts'
import type { Frame } from '../../../../state/frames.ts'
import type { Run } from '../../../../state/run.ts'
import type { Starting, StepReport } from '../../../../state/starting.ts'
import { refusalWords } from '../../rig/words.ts'

export type Tone = 'done' | 'running' | 'next' | 'failed'

export interface StepRow {
  readonly label: string
  readonly value: string
  readonly tone: Tone
}

export const stepNames: Readonly<Record<StartStep, string>> = { home: 'Home', 'stop-guiding': 'Stop guiding', centre: 'Slew and centre', autofocus: 'Autofocus', guiding: 'Guiding', capture: 'Capture' }

export const failedSteps = (starting: Starting | undefined): ReadonlyArray<string> =>
  (starting?.steps ?? []).filter(report => report.outcome === 'failed').map(report => `${stepNames[report.step]} failed at start`)

const shownSteps: ReadonlyArray<readonly [StartStep, string]> = [
  ['home', 'Home'],
  ['centre', 'Slew and centre'],
  ['autofocus', 'Autofocus'],
  ['guiding', 'Guiding'],
]

export const duration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))

  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const clockDuration = (milliseconds: number) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export const focusProgress = (autofocus: Autofocus) => (autofocus.positions.length === 0 ? undefined : `${autofocus.samples.length} of ${autofocus.positions.length + 1}`)

function stepRow(step: StartStep, label: string, report: StepReport | undefined, autofocus: Autofocus, now: number): StepRow {
  if (report === undefined) return { label, value: 'Next', tone: 'next' }

  const took = duration((report.outcome === 'started' ? now : report.at) - report.since)

  switch (report.outcome) {
    case 'started': {
      const progress = step === 'autofocus' ? focusProgress(autofocus) : undefined

      return { label, value: [progress ?? 'Under way', took].join(' · '), tone: 'running' }
    }
    case 'done':
      return { label, value: `Done · ${took}`, tone: 'done' }
    case 'stopped':
      return { label, value: `Stopped · ${took}`, tone: 'failed' }
    case 'failed': {
      const { happened } = report.refusal === undefined ? { happened: 'Failed' } : refusalWords(report.refusal)

      return { label, value: `${happened} · ${took} · went on`, tone: 'failed' }
    }
  }
}

export interface Exposing {
  readonly frame: number
  readonly leftMs: number
  readonly exposureMs: number
}

export function exposing(run: Run, frames: ReadonlyArray<Frame>, now: number): Exposing {
  const kept = framesOf(run, frames)
  const exposureMs = run.exposureSeconds * 1000
  const since = Math.max(run.startedAt, kept.at(-1)?.keptAt ?? run.startedAt)

  return { frame: kept.length + 1, leftMs: exposureMs - (now - since), exposureMs }
}

const exposingWords = ({ frame, leftMs }: Exposing) => (leftMs > 0 ? `Frame ${frame} · ${clockDuration(leftMs)} left` : `Frame ${frame} · saving`)

function frameRows(run: Run | undefined, found: FirstFrames | undefined, limits: FirstFramesLimits | undefined, frames: ReadonlyArray<Frame>, now: number): ReadonlyArray<StepRow> {
  const range = found?.checked ?? (limits === undefined ? undefined : checkedFrames(limits))
  const settledLabel = range === undefined ? 'Settling frames' : `Frames 1 to ${range.from - 1}`
  const checkedLabel = range === undefined ? 'Checked frames' : `Frames ${range.from} to ${range.to}`

  if (run === undefined || found === undefined) return [{ label: settledLabel, value: 'Next', tone: 'next' }, { label: checkedLabel, value: 'Next', tone: 'next' }]

  const taking = exposing(run, frames, now)

  if (taking.frame < found.checked.from) return [{ label: settledLabel, value: exposingWords(taking), tone: 'running' }, { label: checkedLabel, value: 'Next', tone: 'next' }]

  const underWay: StepRow = { label: checkedLabel, value: taking.frame <= found.checked.to ? exposingWords(taking) : 'Measuring', tone: 'running' }
  const checked: StepRow = found.stage === 'settling' || found.stage === 'checking' ? underWay : { label: checkedLabel, value: 'Checked', tone: 'done' }

  return [{ label: settledLabel, value: 'Skipped, settling', tone: 'done' }, checked]
}

export function startingRows(starting: Starting | undefined, run: Run | undefined, found: FirstFrames | undefined, limits: FirstFramesLimits | undefined, autofocus: Autofocus, frames: ReadonlyArray<Frame>, now: number): ReadonlyArray<StepRow> {
  const steps = starting === undefined ? [] : shownSteps.map(([step, label]) => stepRow(step, label, starting.steps.find(report => report.step === step), autofocus, now))

  return [...steps, ...frameRows(run, found, limits, frames, now)]
}

export const runningStep = (starting: Starting | undefined): StartStep | undefined => starting?.steps.find(report => report.outcome === 'started')?.step
