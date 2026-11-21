import { describe, expect, it } from 'vitest'
import { frameDegrees } from './frame-field.ts'
import { bearingBetween, boxOutline, footprintOf, frameDrawing } from './horizon-frame.ts'

const key = (point: { readonly eastDegrees: number; readonly northDegrees: number }) => `${point.eastDegrees.toFixed(6)},${point.northDegrees.toFixed(6)}`

describe("the camera's box on the sky", () => {
  it('is the camera field with a run of points along each of four edges', () => {
    const outline = boxOutline(null, 5)

    expect(outline).toHaveLength(20)
    expect(Math.max(...outline.map(point => point.eastDegrees))).toBeCloseTo(frameDegrees.width / 2)
    expect(Math.max(...outline.map(point => point.northDegrees))).toBeCloseTo(frameDegrees.height / 2)
    expect(frameDrawing.edgeSamples).toBeGreaterThanOrEqual(1)
  })

  it('turns clockwise on a chart with north up and east to the left, as the picker draws it', () => {
    const [, topRight] = boxOutline(0, 1)
    const [, turnedTopRight] = boxOutline(90, 1)

    expect(topRight).toEqual({ eastDegrees: -frameDegrees.width / 2, northDegrees: frameDegrees.height / 2 })
    expect(turnedTopRight!.eastDegrees).toBeCloseTo(-frameDegrees.height / 2)
    expect(turnedTopRight!.northDegrees).toBeCloseTo(-frameDegrees.width / 2)
  })

  it('is the same outline turned half a way round, so the pier side does not matter', () => {
    const asKept = (angle: number) => boxOutline(angle, 6).map(key).sort()

    expect(asKept(37)).toEqual(asKept(217))
    expect(asKept(-52)).toEqual(asKept(128))
    expect(asKept(37)).not.toEqual(asKept(38))
  })

  it('has a first point of north up when no angle is known', () => {
    expect(boxOutline(null, 3).map(key)).toEqual(boxOutline(0, 3).map(key))
  })
})

describe('where the box lands in altitude and azimuth', () => {
  const centre = { azimuthDegrees: 200, altitudeDegrees: 40 }

  it('measures the bearing of a point above, below and to the sides of another', () => {
    expect(bearingBetween(centre, { azimuthDegrees: 200, altitudeDegrees: 41 })).toBeCloseTo(0)
    expect(bearingBetween(centre, { azimuthDegrees: 200, altitudeDegrees: 39 })).toBeCloseTo(180)
    expect(bearingBetween(centre, { azimuthDegrees: 201, altitudeDegrees: 40 })).toBeGreaterThan(80)
    expect(bearingBetween(centre, { azimuthDegrees: 199, altitudeDegrees: 40 })).toBeLessThan(-80)
  })

  it('stays centred on the target, and is wider in azimuth the higher the target is', () => {
    const spanAt = (altitudeDegrees: number) => {
      const azimuths = footprintOf({ azimuthDegrees: 200, altitudeDegrees }, 0, null, 8).map(point => point.azimuthDegrees)

      return Math.max(...azimuths) - Math.min(...azimuths)
    }

    expect(spanAt(10)).toBeCloseTo(frameDegrees.width / Math.cos((10 * Math.PI) / 180), 1)
    expect(spanAt(70)).toBeGreaterThan(2.5 * spanAt(10))
  })

  it('has its top edge above and its bottom edge below the target when north is straight up', () => {
    const drawn = footprintOf(centre, 0, null, 4)

    expect(Math.max(...drawn.map(point => point.altitudeDegrees))).toBeGreaterThan(40 + frameDegrees.height / 2 - 0.01)
    expect(Math.min(...drawn.map(point => point.altitudeDegrees))).toBeLessThan(40 - frameDegrees.height / 2 + 0.01)
  })

  it('keeps azimuth running past 360 when the footprint crosses north', () => {
    const drawn = footprintOf({ azimuthDegrees: 359, altitudeDegrees: 50 }, 0, null, 4).map(point => point.azimuthDegrees)

    expect(Math.max(...drawn)).toBeGreaterThan(360)
    expect(Math.min(...drawn)).toBeLessThan(359)
  })
})
