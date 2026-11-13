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
  errors: Schema.Array(AlignmentError),
})

export type Alignment = typeof Alignment.Type

export const noAlignment: Alignment = { errors: [] }

export function alignment(state: Alignment, entry: RigEntry): Alignment {
  if (entry.kind === 'vela.align.started') return { run: entry.body.run, errors: [] }
  if (entry.kind !== 'vela.align.solve' || entry.body.run !== state.run) return state

  const { frame, altitudeArcmin, azimuthArcmin, totalArcmin } = entry.body
  const measured = altitudeArcmin !== undefined && azimuthArcmin !== undefined && totalArcmin !== undefined
  const errors = measured ? [...state.errors, { frame, at: entry.at, altitudeArcmin, azimuthArcmin, totalArcmin }] : state.errors

  return { ...state, lastFrame: frame, lastFrameAt: entry.at, errors }
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
