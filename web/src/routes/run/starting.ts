import type { Autofocus } from '../../../../state/autofocus.ts'
import type { StartStep } from '../../../../state/entries.ts'
import { framesOf, type FirstFrames } from '../../../../state/first-frames.ts'
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

function frameRows(run: Run | undefined, found: FirstFrames | undefined, frames: ReadonlyArray<Frame>, now: number): ReadonlyArray<StepRow> {
  const settledLabel = found === undefined ? 'Frames 1 to 2' : `Frames 1 to ${found.checked.from - 1}`
  const checkedLabel = found === undefined ? 'Frames 3 to 5' : `Frames ${found.checked.from} to ${found.checked.to}`

  if (run === undefined || found === undefined) return [{ label: settledLabel, value: 'Next', tone: 'next' }, { label: checkedLabel, value: 'Next', tone: 'next' }]

  const current = exposingWords(exposing(run, frames, now))

  if (found.stage === 'settling') return [{ label: settledLabel, value: current, tone: 'running' }, { label: checkedLabel, value: 'Next', tone: 'next' }]

  const checked = found.stage === 'checking' ? { value: current, tone: 'running' as const } : { value: 'Checked', tone: 'done' as const }

  return [{ label: settledLabel, value: 'Skipped, settling', tone: 'done' }, { label: checkedLabel, ...checked }]
}

export function startingRows(starting: Starting | undefined, run: Run | undefined, found: FirstFrames | undefined, autofocus: Autofocus, frames: ReadonlyArray<Frame>, now: number): ReadonlyArray<StepRow> {
  const steps = starting === undefined ? [] : shownSteps.map(([step, label]) => stepRow(step, label, starting.steps.find(report => report.step === step), autofocus, now))

  return [...steps, ...frameRows(run, found, frames, now)]
}

export const runningStep = (starting: Starting | undefined): StartStep | undefined => starting?.steps.find(report => report.outcome === 'started')?.step
