import type { TargetPosition } from '@vela/model/web'

/** Inverse gnomonic projection: offsets on the camera tangent plane to ICRS. */
export function offsetPosition(center: TargetPosition, eastDegrees: number, northDegrees: number): TargetPosition {
  const rad = Math.PI / 180
  const x = Math.tan(eastDegrees * rad), y = Math.tan(northDegrees * rad)
  const ra = center.raDegrees * rad, dec = center.decDegrees * rad
  const denominator = Math.cos(dec) - y * Math.sin(dec)
  return { raDegrees: ((ra + Math.atan2(x, denominator)) / rad + 360) % 360,
    decDegrees: Math.atan2(Math.sin(dec) + y * Math.cos(dec), Math.hypot(denominator, x)) / rad }
}
export function frameCorners(center: TargetPosition, width: number, height: number, rotation: number): TargetPosition[] {
  const rad = Math.PI / 180
  const angle = rotation * rad
  return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const x = sx! * Math.tan(width * rad / 2), y = sy! * Math.tan(height * rad / 2)
    return offsetPosition(center, Math.atan(x * Math.cos(angle) - y * Math.sin(angle)) / rad, Math.atan(x * Math.sin(angle) + y * Math.cos(angle)) / rad)
  })
}
