import { Schema } from 'effect'
import type { PixelBox } from './crop-box.ts'
import { FrameFile, NightName, SkyPosition, type RigEntry } from './entries.ts'

export const Measurements = Schema.Struct({
  stars: Schema.NullOr(Schema.Number),
  hfdPixels: Schema.NullOr(Schema.Number),
  elongation: Schema.NullOr(Schema.Number),
  sky: Schema.Number,
  noise: Schema.Number,
  centre: Schema.optionalKey(Schema.NullOr(SkyPosition)),
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

export const previewPath = '/preview'

export const PreviewAsked = Schema.Struct({ night: NightName, file: FrameFile })

export const frameShapePath = '/frame-shape'

export const FrameShape = Schema.Struct({ width: Schema.Int, height: Schema.Int })

export type FrameShape = typeof FrameShape.Type

export const frameCropPath = '/frame-crop'

export const CropAsked = Schema.Struct({ night: NightName, file: FrameFile, x: Schema.FiniteFromString, y: Schema.FiniteFromString, width: Schema.FiniteFromString, height: Schema.FiniteFromString })

export const previewAddress = ({ night, file }: Pick<Frame, 'night' | 'file'>) => `${previewPath}?${new URLSearchParams({ night, file }).toString()}`

export const frameShapeAddress = ({ night, file }: Pick<Frame, 'night' | 'file'>) => `${frameShapePath}?${new URLSearchParams({ night, file }).toString()}`

export const cropAddress = ({ night, file }: Pick<Frame, 'night' | 'file'>, { x, y, width, height }: PixelBox) =>
  `${frameCropPath}?${new URLSearchParams({ night, file, x: String(x), y: String(y), width: String(width), height: String(height) }).toString()}`

const sameFrame = (night: NightName, file: FrameFile) => (frame: Frame) => frame.night === night && frame.file === file

export function frames(state: ReadonlyArray<Frame>, entry: RigEntry): ReadonlyArray<Frame> {
  switch (entry.kind) {
    case 'vela.frame': {
      const { night, file, sequence } = entry.body

      if (state.some(sameFrame(night, file))) return state

      return [...state, { night, file, ...(sequence === undefined ? {} : { sequence }), keptAt: entry.at, measurements: undefined }]
    }
    case 'vela.frame.stats': {
      const { night, file, stars, hfdPixels, elongation, sky, noise, centre } = entry.body
      const isMeasured = sameFrame(night, file)

      if (!state.some(isMeasured)) return state

      return state.map(frame => (isMeasured(frame) ? { ...frame, measurements: { stars, hfdPixels, elongation, sky, noise, ...(centre === undefined ? {} : { centre }) } } : frame))
    }
    default:
      return state
  }
}
