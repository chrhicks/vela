import { Schema } from 'effect'
import { RunId, type RigEntry } from './entries.ts'

export const AlignmentError = Schema.Struct({
  frame: Schema.Number,
  at: Schema.Number,
  altitudeArcmin: Schema.Number,
  azimuthArcmin: Schema.Number,
  totalArcmin: Schema.Number,
})

export type AlignmentError = typeof AlignmentError.Type

export const Alignment = Schema.Struct({
  run: Schema.optional(RunId),
  lastFrame: Schema.optional(Schema.Number),
  lastFrameAt: Schema.optional(Schema.Number),
  lastSolved: Schema.optional(Schema.Boolean),
  errors: Schema.Array(AlignmentError),
  before: Schema.optional(AlignmentError),
})

export type Alignment = typeof Alignment.Type

export const noAlignment: Alignment = { errors: [] }

export function alignment(state: Alignment, entry: RigEntry): Alignment {
  if (entry.kind === 'vela.align.started') {
    const before = state.lastSolved === false ? undefined : state.errors.at(-1)

    return { run: entry.body.run, errors: [], ...(before === undefined ? {} : { before }) }
  }
  if (entry.kind !== 'vela.align.solve' || entry.body.run !== state.run) return state

  const { frame, altitudeArcmin, azimuthArcmin, totalArcmin } = entry.body
  const measured = altitudeArcmin !== undefined && azimuthArcmin !== undefined && totalArcmin !== undefined
  const errors = measured ? [...state.errors, { frame, at: entry.at, altitudeArcmin, azimuthArcmin, totalArcmin }] : state.errors

  return { ...state, lastFrame: frame, lastFrameAt: entry.at, lastSolved: entry.body.solved !== false, errors }
}

export interface SinceLastRun {
  readonly before: AlignmentError
  readonly now: AlignmentError
  readonly apartArcmin: number
}

export function sinceLastRun({ before, errors }: Alignment): SinceLastRun | undefined {
  const now = errors[0]

  if (before === undefined || now === undefined) return undefined

  return { before, now, apartArcmin: Math.hypot(now.altitudeArcmin - before.altitudeArcmin, now.azimuthArcmin - before.azimuthArcmin) }
}

export type Instruction = 'measuring' | 'good' | 'raise' | 'lower' | 'turnEast' | 'turnWest'

export function instruction(latest: AlignmentError | undefined, goodArcmin: number): Instruction {
  if (latest === undefined) return 'measuring'
  if (latest.totalArcmin < goodArcmin) return 'good'
  if (Math.abs(latest.altitudeArcmin) >= Math.abs(latest.azimuthArcmin)) return latest.altitudeArcmin > 0 ? 'lower' : 'raise'

  return latest.azimuthArcmin > 0 ? 'turnWest' : 'turnEast'
}

export type Trend = 'falling' | 'rising' | 'steady'

export function trend(errors: ReadonlyArray<AlignmentError>): Trend | undefined {
  const [before, latest] = errors.slice(-2)

  if (before === undefined || latest === undefined) return undefined

  return latest.totalArcmin < before.totalArcmin ? 'falling' : latest.totalArcmin > before.totalArcmin ? 'rising' : 'steady'
}
