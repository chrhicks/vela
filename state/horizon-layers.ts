import { Schema } from 'effect'
import { described } from './described.ts'

export const Layer = Schema.Literals(['frame', 'moon'])

export type Layer = typeof Layer.Type

export const LayerSettings = Schema.Struct({
  onAtStart: described('The layers of the horizon chart that are on when the page opens', Schema.Array(Layer), ['frame', 'moon']),
})

export type LayerSettings = typeof LayerSettings.Type

export const layerSettings: LayerSettings = Schema.decodeSync(LayerSettings)({})

export interface LayerChip {
  readonly layer: Layer
  readonly letter: string
  readonly label: string
}

export const layerChips: ReadonlyArray<LayerChip> = [
  { layer: 'frame', letter: 'A', label: 'Frame' },
  { layer: 'moon', letter: 'E', label: 'Moon' },
]

export const layersAtStart = (): ReadonlySet<Layer> => new Set(layerSettings.onAtStart)

export function toggled(layers: ReadonlySet<Layer>, layer: Layer): ReadonlySet<Layer> {
  const next = new Set(layers)

  if (next.has(layer)) next.delete(layer)
  else next.add(layer)

  return next
}
