const radians = Math.PI / 180

export interface Position {
  readonly raDegrees: number
  readonly decDegrees: number
}

export function angularDistance(a: Position, b: Position): number {
  const dec1 = a.decDegrees * radians
  const dec2 = b.decDegrees * radians

  const half =
    Math.sin((dec2 - dec1) / 2) ** 2 +
    Math.cos(dec1) * Math.cos(dec2) * Math.sin(((b.raDegrees - a.raDegrees) * radians) / 2) ** 2

  return (2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, half))))) / radians
}
