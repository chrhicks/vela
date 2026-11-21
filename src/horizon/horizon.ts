import { Schema } from 'effect'
import { HorizonSource } from '../../state/horizon-source.ts'

const binsAround = 360

const Bins = <S extends Schema.Top>(item: S) => Schema.Array(item).check(Schema.isBetweenLength(binsAround, binsAround))

const IsoTime = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/))

export const Horizon = Schema.Struct({
  version: Schema.Literal(2),
  stepDegrees: Schema.Literal(1),
  altitudesDegrees: Bins(Schema.NullOr(Schema.Finite)),
  sources: Bins(Schema.NullOr(HorizonSource)),
  observedAt: Bins(Schema.NullOr(IsoTime)),
})

export type Horizon = typeof Horizon.Type

const unknownEverywhere = <A>(): ReadonlyArray<A | null> => Array.from({ length: binsAround }, () => null)

export const noHorizon: Horizon = {
  version: 2,
  stepDegrees: 1,
  altitudesDegrees: unknownEverywhere(),
  sources: unknownEverywhere(),
  observedAt: unknownEverywhere(),
}

export const altitudeAt = (horizon: Horizon, azimuthDegrees: number): number | null => {
  if (!Number.isFinite(azimuthDegrees)) return null

  const wrapped = ((azimuthDegrees % binsAround) + binsAround) % binsAround
  const lower = Math.floor(wrapped)
  const below = horizon.altitudesDegrees[lower % binsAround] ?? null
  const above = horizon.altitudesDegrees[(lower + 1) % binsAround] ?? null

  if (below === null || above === null) return null

  return below + (above - below) * (wrapped - lower)
}
