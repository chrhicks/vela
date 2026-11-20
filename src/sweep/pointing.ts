import type { PierSide } from '../../state/entries.ts'
import type { Horizontal } from '../sky/horizontal.ts'

export type PointingSource = 'solve' | 'commanded+offset' | 'commanded'

export interface Offset {
  readonly altitudeDegrees: number
  readonly azimuthDegrees: number
}

export interface KnownOffset {
  readonly pierSide: PierSide | undefined
  readonly offset: Offset
}

export interface Pointing extends Horizontal {
  readonly source: PointingSource
}

const wrapTurn = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

const wrapAzimuth = (degrees: number) => ((degrees % 360) + 360) % 360

export const offsetOf = (solved: Horizontal, commanded: Horizontal): Offset => ({
  altitudeDegrees: solved.altitudeDegrees - commanded.altitudeDegrees,
  azimuthDegrees: wrapTurn(solved.azimuthDegrees - commanded.azimuthDegrees),
})

export function pointingOf(frame: { readonly solved: Horizontal | undefined; readonly commanded: Horizontal; readonly pierSide: PierSide | undefined }, known: ReadonlyArray<KnownOffset>): Pointing {
  if (frame.solved !== undefined) return { ...frame.solved, source: 'solve' }

  const latest = [...known].reverse().find(item => item.pierSide === frame.pierSide)

  if (latest === undefined) return { ...frame.commanded, source: 'commanded' }

  return {
    altitudeDegrees: frame.commanded.altitudeDegrees + latest.offset.altitudeDegrees,
    azimuthDegrees: wrapAzimuth(frame.commanded.azimuthDegrees + latest.offset.azimuthDegrees),
    source: 'commanded+offset',
  }
}
