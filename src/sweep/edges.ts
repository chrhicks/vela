import { Schema } from 'effect'
import type { CellLabel } from './cells.ts'
import type { CellSettings } from './settings.ts'

export interface PlacedCell {
  readonly altitudeDegrees: number
  readonly azimuthDegrees: number
  readonly label: CellLabel
}

export const EdgeHow = Schema.Literals(['edge', 'open', 'blocked'])

export type EdgeHow = typeof EdgeHow.Type

export const Edge = Schema.Struct({
  bin: Schema.Int,
  azimuthDegrees: Schema.Number,
  cells: Schema.Int,
  misfits: Schema.Int,
  how: EdgeHow,
  edgeAltitudeDegrees: Schema.optionalKey(Schema.Number),
  blockedAltitudeDegrees: Schema.optionalKey(Schema.Number),
  skyAltitudeDegrees: Schema.optionalKey(Schema.Number),
})

export type Edge = typeof Edge.Type

const rangeOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

function edgeOfBin(bin: number, inBin: ReadonlyArray<PlacedCell>, settings: Pick<CellSettings, 'edgeBinDegrees'>): Edge | undefined {
  const decided = inBin.filter(cell => cell.label !== 'partly blocked').sort((a, b) => a.altitudeDegrees - b.altitudeDegrees)

  if (decided.length === 0) return undefined

  const azimuthDegrees = (bin + 0.5) * settings.edgeBinDegrees
  const misfits = rangeOf(0, decided.length).map(cut => decided.slice(0, cut).filter(cell => cell.label === 'sky').length + decided.slice(cut).filter(cell => cell.label === 'blocked').length)
  const fewest = Math.min(...misfits)
  const best = rangeOf(0, decided.length).filter(cut => misfits[cut] === fewest)
  const between = best.filter(cut => cut > 0 && cut < decided.length)
  const common = { bin, azimuthDegrees, cells: inBin.length, misfits: fewest }

  if (between.length === 0) return best.includes(0) ? { ...common, how: 'open', skyAltitudeDegrees: decided[0]!.altitudeDegrees } : { ...common, how: 'blocked', blockedAltitudeDegrees: decided.at(-1)!.altitudeDegrees }

  const lowest = Math.min(...between)
  const highest = Math.max(...between)
  const cutAt = (cut: number) => (decided[cut - 1]!.altitudeDegrees + decided[cut]!.altitudeDegrees) / 2

  return { ...common, how: 'edge', edgeAltitudeDegrees: (cutAt(lowest) + cutAt(highest)) / 2, blockedAltitudeDegrees: decided[lowest - 1]!.altitudeDegrees, skyAltitudeDegrees: decided[highest]!.altitudeDegrees }
}

export function edgesOf(cells: ReadonlyArray<PlacedCell>, settings: Pick<CellSettings, 'edgeBinDegrees'>): ReadonlyArray<Edge> {
  const bins = new Map<number, Array<PlacedCell>>()

  for (const cell of cells) {
    const bin = Math.floor((((cell.azimuthDegrees % 360) + 360) % 360) / settings.edgeBinDegrees)

    bins.set(bin, [...(bins.get(bin) ?? []), cell])
  }

  return [...bins.entries()].sort((a, b) => a[0] - b[0]).flatMap(([bin, inBin]) => edgeOfBin(bin, inBin, settings) ?? [])
}
