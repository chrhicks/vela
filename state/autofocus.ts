import { Schema } from 'effect'
import { RunId, type RigEntry } from './entries.ts'

export const FocusSample = Schema.Struct({ frame: Schema.Number, position: Schema.Number, hfd: Schema.NullOr(Schema.Number), stars: Schema.Number })

export type FocusSample = typeof FocusSample.Type

export const Autofocus = Schema.Struct({
  run: Schema.optional(RunId),
  positions: Schema.Array(Schema.Number),
  samples: Schema.Array(FocusSample),
  best: Schema.optional(Schema.Number),
})

export type Autofocus = typeof Autofocus.Type

export const noAutofocus: Autofocus = { positions: [], samples: [] }

export function autofocus(state: Autofocus, entry: RigEntry): Autofocus {
  switch (entry.kind) {
    case 'vela.focus.started':
      return { run: entry.body.run, positions: entry.body.positions, samples: [] }
    case 'vela.focus.sample': {
      if (entry.body.run !== state.run) return state

      const { frame, position, hfd, stars } = entry.body

      return { ...state, samples: [...state.samples, { frame, position, hfd, stars }] }
    }
    case 'vela.focus.best':
      return entry.body.run === state.run ? { ...state, best: entry.body.position } : state
    default:
      return state
  }
}

export const sweepOf = (state: Autofocus) => state.samples.filter(sample => sample.frame <= state.positions.length)

export const checkOf = (state: Autofocus) => state.samples.find(sample => sample.frame > state.positions.length)
