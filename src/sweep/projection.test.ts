import { describe, expect, it } from 'vitest'
import { angularDistance } from '../../state/angles.ts'
import { cellCentres, skyOfPixel, type FrameGeometry } from './projection.ts'

const size = { width: 6248, height: 4176 }
const geometry = (overrides: Partial<FrameGeometry> = {}): FrameGeometry => ({ centre: { raDegrees: 100, decDegrees: 20 }, rotationDegrees: 0, scaleArcsecPerPixel: 2, size, ...overrides })
const middle = { x: (size.width + 1) / 2, y: (size.height + 1) / 2 }
const degreesPerPixel = 2 / 3600

describe('a pixel in the sky', () => {
  it('is the solve centre at the middle of the frame', () => {
    const sky = skyOfPixel(geometry(), middle)

    expect(sky.raDegrees).toBeCloseTo(100, 9)
    expect(sky.decDegrees).toBeCloseTo(20, 9)
  })

  it('is east to the right and north up at rotation 0', () => {
    const east = skyOfPixel(geometry({ centre: { raDegrees: 100, decDegrees: 0 } }), { x: middle.x + 1000, y: middle.y })
    const north = skyOfPixel(geometry({ centre: { raDegrees: 100, decDegrees: 0 } }), { x: middle.x, y: middle.y + 1000 })

    expect(east.raDegrees).toBeCloseTo(100 + 1000 * degreesPerPixel, 4)
    expect(east.decDegrees).toBeCloseTo(0, 6)
    expect(north.decDegrees).toBeCloseTo(1000 * degreesPerPixel, 4)
    expect(north.raDegrees).toBeCloseTo(100, 6)
  })

  it('turns the frame by the rotation: at 90 degrees the x axis points north', () => {
    const sky = skyOfPixel(geometry({ rotationDegrees: 90, centre: { raDegrees: 100, decDegrees: 0 } }), { x: middle.x + 1000, y: middle.y })

    expect(sky.decDegrees).toBeCloseTo(1000 * degreesPerPixel, 4)
    expect(sky.raDegrees).toBeCloseTo(100, 6)
  })

  it('is the same distance from the centre whatever the rotation', () => {
    const away = { x: middle.x + 2500, y: middle.y - 1700 }
    const distances = [0, 33, 90, 200].map(rotationDegrees => angularDistance(skyOfPixel(geometry({ rotationDegrees }), away), { raDegrees: 100, decDegrees: 20 }))

    for (const distance of distances) expect(distance).toBeCloseTo(distances[0]!, 9)
    expect(distances[0]).toBeCloseTo(Math.atan(Math.hypot(2500, 1700) * degreesPerPixel * (Math.PI / 180)) * (180 / Math.PI), 9)
  })

  it('wraps right ascension at 0 and 360', () => {
    const sky = skyOfPixel(geometry({ centre: { raDegrees: 359.9, decDegrees: 0 } }), { x: middle.x + 1000, y: middle.y })

    expect(sky.raDegrees).toBeGreaterThanOrEqual(0)
    expect(sky.raDegrees).toBeCloseTo(0.4556, 3)
  })

  it('goes round the pole without a jump near the pole', () => {
    const sky = skyOfPixel(geometry({ centre: { raDegrees: 10, decDegrees: 89.5 } }), { x: middle.x, y: middle.y + 1000 })

    expect(sky.decDegrees).toBeLessThanOrEqual(90)
    expect(Number.isFinite(sky.raDegrees)).toBe(true)
  })
})

describe('the centres of the cells', () => {
  it('are one position for each cell of the grid', () => {
    expect(cellCentres(geometry(), { columns: 8, rows: 6 })).toHaveLength(48)
  })

  it('are numbered across each row, so a later column is further east and a later row further north at rotation 0', () => {
    const centres = cellCentres(geometry({ centre: { raDegrees: 100, decDegrees: 0 } }), { columns: 2, rows: 2 })

    expect(centres[1]!.raDegrees).toBeGreaterThan(centres[0]!.raDegrees)
    expect(centres[2]!.decDegrees).toBeGreaterThan(centres[0]!.decDegrees)
  })
})
