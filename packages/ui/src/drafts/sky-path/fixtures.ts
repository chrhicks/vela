import type { SkyPathHorizon, SkyPathMoonSample, SkyPathSample } from '../SkyPath'

export type DemoHorizonState = 'none' | 'local' | 'incomplete' | 'uncalibrated'
export type DemoSkyTargetId = 'andromeda' | 'm13' | 'crescent' | 'low-target'

// Entirely invented workshop geometry. These are not catalog ephemerides or
// an observer's real location; see README.md for the specimen assumptions.
const sampleLatitudeDegrees = 40
const sampleTargets: Record<DemoSkyTargetId, { declinationDegrees: number; transitHour: number }> = {
  andromeda: { declinationDegrees: 42, transitHour: 25 },
  m13: { declinationDegrees: 25, transitHour: 18 },
  crescent: { declinationDegrees: 26, transitHour: 24 },
  'low-target': { declinationDegrees: -32, transitHour: 24 },
}

const radians = (degrees: number) => degrees * Math.PI / 180
const degrees = (radians: number) => radians * 180 / Math.PI

export function getSkySamples(targetId: string): SkyPathSample[] {
  const target = sampleTargets[Object.hasOwn(sampleTargets, targetId) ? targetId as DemoSkyTargetId : 'andromeda']
  const latitude = radians(sampleLatitudeDegrees)
  const declination = radians(target.declinationDegrees)

  return Array.from({ length: 49 }, (_, index) => {
    const elapsedMinutes = index * 10
    const hourAngle = radians((20 + elapsedMinutes / 60 - target.transitHour) * 15)
    const east = -Math.cos(declination) * Math.sin(hourAngle)
    const north = Math.sin(declination) * Math.cos(latitude)
      - Math.cos(declination) * Math.cos(hourAngle) * Math.sin(latitude)
    const up = Math.sin(declination) * Math.sin(latitude)
      + Math.cos(declination) * Math.cos(hourAngle) * Math.cos(latitude)
    const clockMinutes = (20 * 60 + elapsedMinutes) % (24 * 60)

    return {
      azimuthDegrees: (degrees(Math.atan2(east, north)) + 360) % 360,
      altitudeDegrees: degrees(Math.asin(Math.max(-1, Math.min(1, up)))),
      label: `${String(Math.floor(clockMinutes / 60)).padStart(2, '0')}:${String(clockMinutes % 60).padStart(2, '0')}`,
    }
  })
}

function angularDistance(azimuth: number, center: number): number {
  return Math.abs(((azimuth - center + 540) % 360) - 180)
}

function demoSkylineAltitude(azimuth: number): number {
  const hill = 14 * Math.exp(-((angularDistance(azimuth, 80) / 44) ** 2))
  const roof = 10 * Math.exp(-((angularDistance(azimuth, 190) / 30) ** 4))
  const trees = 20 * Math.exp(-((angularDistance(azimuth, 305) / 22) ** 2))
  return 3 + hill + roof + trees
}

export function getDemoHorizon(profileState: string): SkyPathHorizon | undefined {
  if (!['local', 'incomplete', 'uncalibrated'].includes(profileState)) return undefined

  return {
    // "Calibrated" is a UI specimen state, never a claim of measured scenery.
    state: profileState === 'uncalibrated' ? 'uncalibrated' : 'calibrated',
    points: Array.from({ length: 73 }, (_, index) => {
      const azimuthDegrees = index * 5
      const unknown = profileState === 'incomplete' && azimuthDegrees >= 20 && azimuthDegrees <= 65
      return {
        azimuthDegrees,
        altitudeDegrees: unknown ? null : demoSkylineAltitude(azimuthDegrees),
      }
    }),
    wires: [Array.from({ length: 13 }, (_, index) => {
      const fraction = index / 12
      return {
        azimuthDegrees: 90 + fraction * 60,
        altitudeDegrees: 27 - 4 * Math.sin(fraction * Math.PI),
      }
    })],
  }
}

// Invented evening Moon setting late in this sample night. No real ephemeris.
export function getMoonSamples(phase = 'gibbous'): (SkyPathMoonSample | null)[] | undefined {
  if (phase === 'none') return undefined
  const illuminationFraction = phase === 'crescent' ? .22 : phase === 'full' ? 1 : phase === 'new' ? 0 : .68
  return Array.from({ length: 49 }, (_, index) => phase === 'unavailable' ? null : ({
    azimuthDegrees: 180 + index * 2.5,
    altitudeDegrees: 48 - index * 1.4,
    illuminationFraction,
    waxing: phase !== 'waning',
  }))
}
