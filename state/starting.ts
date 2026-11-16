import { Schema } from 'effect'
import { Refusal } from './commands.ts'
import { StartId, StartStep, StepOutcome, type RigEntry } from './entries.ts'
import { RunTarget } from './targets.ts'

export const StepReport = Schema.Struct({ step: StartStep, outcome: StepOutcome, since: Schema.Number, at: Schema.Number, refusal: Schema.optional(Refusal) })

export type StepReport = typeof StepReport.Type

export const Starting = Schema.Struct({ start: StartId, target: RunTarget, startedAt: Schema.Number, steps: Schema.Array(StepReport) })

export type Starting = typeof Starting.Type

export function starting(state: Starting | undefined, entry: RigEntry): Starting | undefined {
  if (entry.kind !== 'vela.target.step') return state

  const { start, target, step, outcome, refusal } = entry.body
  const earlier = state?.start === start ? state : { start, target, startedAt: entry.at, steps: [] }
  const before = earlier.steps.find(reported => reported.step === step)
  const report: StepReport = { step, outcome, since: before?.since ?? entry.at, at: entry.at, refusal }

  return { ...earlier, steps: [...earlier.steps.filter(reported => reported.step !== step), report] }
}

export const isStarting = (state: Starting | undefined) => state?.steps.some(report => report.outcome === 'started') === true
