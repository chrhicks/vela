import { Schema } from 'effect'
import { NightName, type RigEntry } from './entries.ts'

export const Stacked = Schema.Struct({ night: NightName, sequence: Schema.String, frames: Schema.Number, leftOut: Schema.Number, at: Schema.Number })

export type Stacked = typeof Stacked.Type

export const stackPicturePath = '/stack-picture'

export const stackPictureAddress = ({ night, sequence, frames }: Pick<Stacked, 'night' | 'sequence' | 'frames'>) =>
  `${stackPicturePath}?${new URLSearchParams({ night, sequence, frames: String(frames) }).toString()}`

export function stacked(state: Stacked | undefined, entry: RigEntry): Stacked | undefined {
  return entry.kind === 'vela.stack' ? { ...entry.body, at: entry.at } : state
}
