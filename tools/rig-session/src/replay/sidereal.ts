/** Local sidereal time in hours: Greenwich mean sidereal time (IAU 1982) plus the east longitude. */
export function localSiderealHours(epochMs: number, eastLongitudeDegrees: number): number {
  const daysSinceJ2000 = epochMs / 86_400_000 + 2440587.5 - 2451545.0
  const local = 18.697374558 + 24.06570982441908 * daysSinceJ2000 + eastLongitudeDegrees / 15

  return ((local % 24) + 24) % 24
}
