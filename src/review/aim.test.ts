import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import type { Site } from '../pointing/target.ts'
import { aimAt } from './aim.ts'

const phoenix: Site = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const at = Date.UTC(2026, 10, 18, 5, 0, 0)
const meridianRa = SiderealTime(new Date(at)) + phoenix.longitudeDegrees / 15

describe('where the telescope points', () => {
  it('puts a target on the meridian at the celestial equator due south, as high as the colatitude', () => {
    expect(aimAt(phoenix, meridianRa, 0, at)).toEqual({ altitudeDegrees: 57, azimuthDegrees: 180 })
  })

  it('puts a target on the meridian at the declination of the latitude at the zenith', () => {
    expect(aimAt(phoenix, meridianRa, 33.45, at).altitudeDegrees).toBe(90)
  })

  it('puts a target six hours east of the meridian on the celestial equator due east', () => {
    expect(aimAt(phoenix, meridianRa + 6, 0, at).azimuthDegrees).toBeLessThan(180)
    expect(aimAt(phoenix, meridianRa + 6, 0, at).azimuthDegrees).toBeGreaterThan(80)
  })
})
