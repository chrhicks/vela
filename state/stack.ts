import { Schema } from 'effect'
import type { PixelBox } from './crop-box.ts'
import { NightName, type RigEntry } from './entries.ts'

export const Stacked = Schema.Struct({ night: NightName, sequence: Schema.String, frames: Schema.Number, leftOut: Schema.Number, at: Schema.Number })

export type Stacked = typeof Stacked.Type

export const stackPicturePath = '/stack-picture'

export const stackPictureAddress = ({ night, sequence, frames }: Pick<Stacked, 'night' | 'sequence' | 'frames'>) =>
  `${stackPicturePath}?${new URLSearchParams({ night, sequence, frames: String(frames) }).toString()}`

export const StackAsked = Schema.Struct({ night: NightName, sequence: Schema.NonEmptyString, frames: Schema.optionalKey(Schema.String) })

export const StackCropAsked = Schema.Struct({ ...StackAsked.fields, x: Schema.FiniteFromString, y: Schema.FiniteFromString, width: Schema.FiniteFromString, height: Schema.FiniteFromString })

export const stackShapePath = '/stack-shape'

export const stackCropPath = '/stack-crop'

export const stackShapeAddress = ({ night, sequence }: Pick<Stacked, 'night' | 'sequence'>) => `${stackShapePath}?${new URLSearchParams({ night, sequence }).toString()}`

export const stackCropAddress = ({ night, sequence, frames }: Pick<Stacked, 'night' | 'sequence' | 'frames'>, { x, y, width, height }: PixelBox) =>
  `${stackCropPath}?${new URLSearchParams({ night, sequence, frames: String(frames), x: String(x), y: String(y), width: String(width), height: String(height) }).toString()}`

export function stacked(state: Stacked | undefined, entry: RigEntry): Stacked | undefined {
  return entry.kind === 'vela.stack' ? { ...entry.body, at: entry.at } : state
}
