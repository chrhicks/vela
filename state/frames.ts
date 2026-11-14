import { Schema } from 'effect'
import { FrameFile, NightName, type RigEntry } from './entries.ts'

export const Measurements = Schema.Struct({
  stars: Schema.NullOr(Schema.Number),
  hfdPixels: Schema.NullOr(Schema.Number),
  elongation: Schema.NullOr(Schema.Number),
  sky: Schema.Number,
  noise: Schema.Number,
})

export type Measurements = typeof Measurements.Type

export const Frame = Schema.Struct({
  night: NightName,
  file: FrameFile,
  sequence: Schema.optionalKey(Schema.String),
  keptAt: Schema.Number,
  measurements: Schema.optional(Measurements),
})

export type Frame = typeof Frame.Type

const sameFrame = (night: NightName, file: FrameFile) => (frame: Frame) => frame.night === night && frame.file === file

export function frames(state: ReadonlyArray<Frame>, entry: RigEntry): ReadonlyArray<Frame> {
  switch (entry.kind) {
    case 'vela.frame': {
      const { night, file, sequence } = entry.body

      if (state.some(sameFrame(night, file))) return state

      return [...state, { night, file, ...(sequence === undefined ? {} : { sequence }), keptAt: entry.at, measurements: undefined }]
    }
    case 'vela.frame.stats': {
      const { night, file, stars, hfdPixels, elongation, sky, noise } = entry.body
      const isMeasured = sameFrame(night, file)

      if (!state.some(isMeasured)) return state

      return state.map(frame => (isMeasured(frame) ? { ...frame, measurements: { stars, hfdPixels, elongation, sky, noise } } : frame))
    }
    default:
      return state
  }
}
