import { Schema } from 'effect'
import { PierSide, RehearsalEnding, RehearsalId, SweepMoved, type RigEntry } from './entries.ts'

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Rehearsal = Schema.Struct({
  rehearsal: RehearsalId,
  total: Count,
  startedAt: Schema.Number,
  updatedAt: Schema.Number,
  moved: Count,
  alerts: Count,
  refused: Count,
  last: Schema.optional(SweepMoved.fields.body),
  side: Schema.optional(PierSide),
  flipped: Schema.Boolean,
  ending: Schema.optional(RehearsalEnding),
  endedAt: Schema.optional(Schema.Number),
})

export type Rehearsal = typeof Rehearsal.Type

export function rehearsal(state: Rehearsal | undefined, entry: RigEntry): Rehearsal | undefined {
  switch (entry.kind) {
    case 'vela.sweep.started':
      return { rehearsal: entry.body.rehearsal, total: entry.body.total, startedAt: entry.at, updatedAt: entry.at, moved: 0, alerts: 0, refused: 0, flipped: false }
    case 'vela.sweep.move': {
      if (state?.rehearsal !== entry.body.rehearsal) return state

      const reported = entry.body.TELESCOPE_PIER_SIDE

      return {
        ...state,
        updatedAt: entry.at,
        moved: state.moved + 1,
        alerts: state.alerts + (entry.body.outcome === 'alert' ? 1 : 0),
        refused: state.refused + (entry.body.outcome === 'refused' ? 1 : 0),
        last: entry.body,
        side: reported ?? state.side,
        flipped: reported !== undefined && state.side !== undefined && reported !== state.side,
      }
    }
    case 'vela.sweep.ended':
      return state?.rehearsal === entry.body.rehearsal ? { ...state, ending: entry.body.ending, updatedAt: entry.at, endedAt: entry.at } : state
    case 'vela.started':
      return state === undefined || state.ending !== undefined ? state : { ...state, ending: 'restarted', updatedAt: entry.at, endedAt: entry.at }
    default:
      return state
  }
}

export const isRehearsing = (state: Rehearsal | undefined) => state !== undefined && state.ending === undefined
