export interface CatalogTarget {
  readonly id: string
  readonly catalogName: string
  readonly commonName: string | null
  readonly aliases: readonly string[]
  readonly raDegrees: number
  readonly decDegrees: number
  readonly type: string
  readonly majorAxisArcminutes: number | null
  readonly minorAxisArcminutes: number | null
}

export type CatalogRow = readonly [
  id: string,
  catalogName: string,
  commonName: string | null,
  aliases: readonly string[],
  raDegrees: number,
  decDegrees: number,
  type: string,
  majorAxisArcminutes: number | null,
  minorAxisArcminutes: number | null,
]
