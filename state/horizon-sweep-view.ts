import type { HorizonNight } from './horizon-night.ts'
import type { EdgeKind, HorizonSweep, SweepFramePoint } from './horizon-sweep.ts'
import type { SkyPoint } from './horizon-view.ts'

export interface TreeLinePiece {
  readonly dotted: boolean
  readonly points: ReadonlyArray<SkyPoint>
}

export interface FrameGroup {
  readonly blocked: boolean
  readonly source: SweepFramePoint['source']
  readonly points: ReadonlyArray<SkyPoint>
}

const fullTurn = 360

export function treeLinePieces(horizon: HorizonNight['horizon'], edges: ReadonlyArray<EdgeKind | null>): ReadonlyArray<TreeLinePiece> {
  const pieces: Array<{ dotted: boolean; points: Array<SkyPoint> }> = []
  const altitudeOf = (bin: number) => horizon.altitudesDegrees[bin % fullTurn] ?? null
  const measured = (bin: number) => edges[bin % fullTurn] === 'edge'

  for (let bin = 0; bin < fullTurn; bin += 1) {
    const here = altitudeOf(bin)
    const next = altitudeOf(bin + 1)

    if (here === null || next === null) continue

    const dotted = !measured(bin) || !measured(bin + 1)
    const open = pieces.at(-1)
    const joins = open !== undefined && open.dotted === dotted && open.points.at(-1)?.azimuthDegrees === bin

    if (!joins) pieces.push({ dotted, points: [{ azimuthDegrees: bin, altitudeDegrees: here }] })

    pieces.at(-1)?.points.push({ azimuthDegrees: bin + 1, altitudeDegrees: next })
  }

  return pieces
}

export function frameGroups(frames: ReadonlyArray<SweepFramePoint>): ReadonlyArray<FrameGroup> {
  const groups = new Map<string, { blocked: boolean; source: SweepFramePoint['source']; points: Array<SkyPoint> }>()

  for (const frame of frames) {
    const blocked = frame.class === 'blocked'
    const key = `${blocked}/${frame.source}`
    const group = groups.get(key) ?? { blocked, source: frame.source, points: [] }

    group.points.push({ azimuthDegrees: frame.azimuthDegrees, altitudeDegrees: frame.altitudeDegrees })
    groups.set(key, group)
  }

  return [...groups.values()]
}

const dayOf = (night: string) => night.slice('0000-'.length)

export const framesWords = (nights: ReadonlyArray<string>): string => `${nights.map(dayOf).join(', ')} frames · + clean ■ blocked · dotted: no cell edge`

export type MapReading = { readonly status: 'read'; readonly sweep: HorizonSweep } | { readonly status: 'unreachable' }

export function mapUnavailableWords(reading: MapReading): string | undefined {
  if (reading.status === 'unreachable') return 'Tree map unavailable: Vela did not answer'

  const { sweep } = reading

  if (sweep.status === 'available') return undefined

  const night = sweep.night === null ? 'the' : `the ${dayOf(sweep.night)}`

  switch (sweep.reason) {
    case 'no-origins':
      return 'Tree map unavailable: the horizon file does not say which sweep each direction came from'
    case 'missing':
      return `Tree map unavailable: ${sweep.file ?? 'a records file'} of ${night} sweep is missing`
    case 'unreadable':
      return `Tree map unavailable: ${sweep.file ?? 'a records file'} of ${night} sweep could not be read`
    case 'no-frames':
      return `Tree map unavailable: the records of ${night} sweep hold no frames of the sweep that built the horizon`
    case 'no-edges':
      return `Tree map unavailable: the records of ${night} sweep hold no cell edges of the sweep that built the horizon`
  }
}
