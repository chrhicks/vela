import { Observer, SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { decodeConfig } from '../config.ts'
import { equatorialOfDate } from '../sky/horizontal.ts'
import { columns, legs, poseAt, poseOfAxes, rehearsalPath, rehearsalRoute, type Pose } from './path.ts'
import { SweepSettings } from './settings.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const settings = decodeConfig(SweepSettings, {})
const at = Date.UTC(2026, 10, 9, 4, 0, 0)

const wrapped = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

const axisTurn = (from: Pose, to: Pose) => ({
  hourAngle: Math.abs(wrapped(to.hourAngleDegrees - from.hourAngleDegrees)),
  declination: Math.abs(to.declinationDegrees - from.declinationDegrees),
})

const hourAngleOf = (raHours: number) => wrapped(SiderealTime(new Date(at)) * 15 + phoenix.longitudeDegrees - raHours * 15)

describe('the sweep settings', () => {
  it('fills the described defaults', () => {
    expect(settings).toEqual({
      columnDegrees: 2.5,
      legDegrees: 5,
      floorDegrees: 2,
      ceilingDegrees: 70,
      meridianLimitDegrees: 15,
      rehearsal: { columnDegrees: 15, rowDegrees: 5 },
    })
  })

  it('refuses a step of zero', () => {
    expect(() => decodeConfig(SweepSettings, { legDegrees: 0 })).toThrow()
    expect(() => decodeConfig(SweepSettings, { rehearsal: { columnDegrees: 0 } })).toThrow()
  })
})

describe('a pose from altitude and azimuth', () => {
  it('has the hour angle and declination the site gives, the same as the astronomy-engine route at that site', () => {
    for (const azimuth of [0.5, 45, 90, 135, 179.9, 190, 225, 270, 315, 359.5])
      for (const altitude of [2, 15, 33, 45, 70]) {
        const pose = poseAt(altitude, azimuth, phoenix, settings)
        const ofDate = equatorialOfDate(altitude, azimuth, at, phoenix)

        expect(pose.declinationDegrees).toBeCloseTo(ofDate.decDegrees, 6)
        expect(Math.abs(wrapped(pose.hourAngleDegrees - hourAngleOf(ofDate.raHours)))).toBeLessThan(1e-6)
      }
  })

  it('goes back to the same altitude and azimuth from its hour angle and declination', () => {
    for (const azimuth of [0.5, 90, 179.9, 190, 270, 359.5])
      for (const altitude of [2, 33, 70]) {
        const pose = poseAt(altitude, azimuth, phoenix, settings)
        const back = poseOfAxes(pose, phoenix, settings)

        expect(back.altitudeDegrees).toBeCloseTo(altitude, 6)
        expect(Math.abs(wrapped(back.azimuthDegrees - azimuth))).toBeLessThan(1e-6)
      }
  })

  it('puts due south on the meridian and due north under the pole at hour angle 180', () => {
    expect(poseAt(40, 180, phoenix, settings).hourAngleDegrees).toBeCloseTo(0, 6)
    expect(Math.abs(poseAt(10, 0, phoenix, settings).hourAngleDegrees)).toBeCloseTo(180, 6)
    expect(poseAt(10, 0, phoenix, settings).declinationDegrees).toBeCloseTo(90 - (phoenix.latitudeDegrees - 10), 6)
  })

  it('puts the north under the pole at hour angle -180 from the east and +180 from the west, so it is on opposite pier sides', () => {
    expect(poseAt(10, 0, phoenix, settings)).toMatchObject({ hourAngleDegrees: -180, predictedPierSide: 'PIER_WEST' })
    expect(poseAt(10, 360, phoenix, settings)).toMatchObject({ predictedPierSide: 'PIER_EAST' })
    expect(poseAt(10, 360, phoenix, settings).hourAngleDegrees).toBeCloseTo(180, 6)
  })

  it('predicts the pier side from the meridian limit: the normal side up to it, the flipped side past it', () => {
    expect(poseOfAxes({ hourAngleDegrees: 15, declinationDegrees: 20 }, phoenix, settings).predictedPierSide).toBe('PIER_WEST')
    expect(poseOfAxes({ hourAngleDegrees: 15.1, declinationDegrees: 20 }, phoenix, settings).predictedPierSide).toBe('PIER_EAST')
    expect(poseOfAxes({ hourAngleDegrees: -120, declinationDegrees: 20 }, phoenix, settings).predictedPierSide).toBe('PIER_WEST')
    expect(poseOfAxes({ hourAngleDegrees: 15.1, declinationDegrees: 20 }, phoenix, { ...settings, meridianLimitDegrees: 30 }).predictedPierSide).toBe('PIER_WEST')
  })
})

describe('the sweep columns', () => {
  it('start at the south meridian, go east round to the north, then the west side round to the north', () => {
    const all = columns({ columnDegrees: 30 })

    expect(all.map(column => column.azimuthDegrees)).toEqual([180, 150, 120, 90, 60, 30, 0, 210, 240, 270, 300, 330, 360])
    expect(all.map(column => column.half)).toEqual([...Array(7).fill('east'), ...Array(6).fill('west')])
  })

  it('are spaced by the setting, and stop short of the north when the spacing does not divide', () => {
    const all = columns({ columnDegrees: 2.5 })
    const east = all.filter(column => column.half === 'east')
    const west = all.filter(column => column.half === 'west')

    expect(east).toHaveLength(73)
    expect(west).toHaveLength(72)
    expect(east[0]!.azimuthDegrees).toBe(180)
    expect(east[72]!.azimuthDegrees).toBe(0)
    expect(west[0]!.azimuthDegrees).toBe(182.5)
    expect(west[71]!.azimuthDegrees).toBe(360)

    const uneven = columns({ columnDegrees: 70 })

    expect(uneven.map(column => column.azimuthDegrees)).toEqual([180, 110, 40, 250, 320])
  })

  it('every azimuth is inside 0 to 360 and each step is the setting', () => {
    const all = columns({ columnDegrees: 2.6 })

    for (const column of all) {
      expect(column.azimuthDegrees).toBeGreaterThanOrEqual(0)
      expect(column.azimuthDegrees).toBeLessThanOrEqual(360)
    }

    for (let index = 1; index < all.length; index += 1) {
      if (all[index]!.half === all[index - 1]!.half) expect(Math.abs(all[index]!.azimuthDegrees - all[index - 1]!.azimuthDegrees)).toBeCloseTo(2.6, 9)
    }
  })
})

describe('legs', () => {
  const grid = [0.5, 30, 90, 150, 179.5, 180.5, 210, 270, 330, 359.5]
  const altitudes = [2, 20, 34, 50, 70]

  it('ends at the destination, starts from the first step and never turns either axis more than the limit', () => {
    for (const fromAzimuth of grid)
      for (const toAzimuth of grid)
        for (const fromAltitude of altitudes)
          for (const toAltitude of altitudes) {
            const from = poseAt(fromAltitude, fromAzimuth, phoenix, settings)
            const to = poseAt(toAltitude, toAzimuth, phoenix, settings)
            const steps = legs(from, to, phoenix, settings)

            expect(steps[steps.length - 1]).toBe(to)

            let previous = from

            for (const step of steps) {
              const turn = axisTurn(previous, step)

              expect(turn.hourAngle).toBeLessThanOrEqual(settings.legDegrees + 1e-6)
              expect(turn.declination).toBeLessThanOrEqual(settings.legDegrees + 1e-6)
              previous = step
            }
          }
  })

  it('is one step when the axes turn the limit or less, and none is added for a move that stays put', () => {
    const from = poseOfAxes({ hourAngleDegrees: -40, declinationDegrees: 10 }, phoenix, settings)

    expect(legs(from, poseOfAxes({ hourAngleDegrees: -35, declinationDegrees: 15 }, phoenix, settings), phoenix, settings)).toHaveLength(1)
    expect(legs(from, poseOfAxes({ hourAngleDegrees: -34.9, declinationDegrees: 10 }, phoenix, settings), phoenix, settings)).toHaveLength(2)
    expect(legs(from, from, phoenix, settings)).toHaveLength(1)
  })

  it('limits the axes and not the sky angle: a one degree move near the pole is many steps', () => {
    const below = poseAt(33, 0, phoenix, settings)
    const above = poseAt(34, 0, phoenix, settings)
    const steps = legs(below, above, phoenix, settings)

    expect(Math.abs(above.hourAngleDegrees - below.hourAngleDegrees)).toBeCloseTo(180, 6)
    expect(steps).toHaveLength(36)
  })

  it('wraps at azimuth 0 and 360: from 359 to 1 degrees azimuth is a short move across hour angle 180, not a trip round the compass', () => {
    const from = poseAt(20, 359, phoenix, settings)
    const to = poseAt(20, 1, phoenix, settings)
    const steps = legs(from, to, phoenix, settings)

    expect(from.hourAngleDegrees).toBeGreaterThan(170)
    expect(to.hourAngleDegrees).toBeLessThan(-170)
    expect(steps.length).toBeLessThanOrEqual(2)
    expect(steps.map(step => step.predictedPierSide)).toEqual(steps.map(step => (step.hourAngleDegrees > 15 ? 'PIER_EAST' : 'PIER_WEST')))
  })

  it('wraps at hour angle 180 and keeps a flipped side move on the flipped side', () => {
    const from = poseOfAxes({ hourAngleDegrees: 170, declinationDegrees: 60 }, phoenix, settings)
    const to = poseOfAxes({ hourAngleDegrees: 178, declinationDegrees: 60 }, phoenix, settings)
    const steps = legs(from, to, phoenix, settings)

    expect(steps.map(step => step.hourAngleDegrees)).toEqual([174, 178])
    expect(steps.every(step => step.predictedPierSide === 'PIER_EAST')).toBe(true)
  })

  it('crosses hour angle 180 between the two sides when that is the shorter way, with hour angle kept from -180 to 180', () => {
    const from = poseOfAxes({ hourAngleDegrees: 176, declinationDegrees: 60 }, phoenix, settings)
    const to = poseOfAxes({ hourAngleDegrees: -170, declinationDegrees: 60 }, phoenix, settings)
    const steps = legs(from, to, phoenix, settings)

    expect(steps).toHaveLength(3)
    expect(steps[0]!.hourAngleDegrees).toBeCloseTo(-179.3333333, 6)
    expect(steps[1]!.hourAngleDegrees).toBeCloseTo(-174.6666667, 6)
    expect(steps[2]!.hourAngleDegrees).toBe(-170)
    expect(steps.map(step => step.predictedPierSide)).toEqual(['PIER_WEST', 'PIER_WEST', 'PIER_WEST'])
  })

  it('goes the side that avoids the meridian limit when the move stays on the normal side', () => {
    const from = poseOfAxes({ hourAngleDegrees: -170, declinationDegrees: 60 }, phoenix, settings)
    const to = poseOfAxes({ hourAngleDegrees: 10, declinationDegrees: 60 }, phoenix, settings)
    const steps = legs(from, to, phoenix, settings)

    expect(steps).toHaveLength(36)
    expect(steps.every(step => step.predictedPierSide === 'PIER_WEST')).toBe(true)
    expect(steps.every(step => step.hourAngleDegrees <= 15)).toBe(true)
  })

  it('crosses the meridian limit when the destination is on the other side', () => {
    const from = poseOfAxes({ hourAngleDegrees: 10, declinationDegrees: 40 }, phoenix, settings)
    const to = poseOfAxes({ hourAngleDegrees: 30, declinationDegrees: 40 }, phoenix, settings)
    const steps = legs(from, to, phoenix, settings)

    expect(steps.map(step => step.hourAngleDegrees)).toEqual([15, 20, 25, 30])
    expect(steps.map(step => step.predictedPierSide)).toEqual(['PIER_WEST', 'PIER_EAST', 'PIER_EAST', 'PIER_EAST'])
  })
})

describe('the rehearsal path', () => {
  const path = rehearsalPath(phoenix, settings)

  it('visits 25 columns of 15 degrees, each from the floor to the ceiling and back, the next going the other way', () => {
    const atColumn = (index: number) => path.filter(move => move.column === index)
    const heights = (index: number) => atColumn(index).map(move => move.pose.altitudeDegrees)
    const reached = [...new Set(path.map(move => move.column))]

    expect(reached).toEqual(Array.from({ length: 25 }, (_, index) => index))
    expect(heights(0)[0]).toBeCloseTo(2, 6)
    expect(heights(0)[heights(0).length - 1]).toBeCloseTo(70, 6)
    expect(heights(1)[heights(1).length - 1]).toBeCloseTo(2, 6)
    expect(heights(2)[heights(2).length - 1]).toBeCloseTo(70, 6)
    expect(heights(13)[heights(13).length - 1]).toBeCloseTo(2, 6)
    expect(heights(24)[heights(24).length - 1]).toBeCloseTo(70, 6)
  })

  it('ends each column at its own azimuth, in the order south, east round to the north, then west round to the north', () => {
    const ends = [0, 1, 6, 12, 13, 14, 24].map(index => {
      const moves = path.filter(move => move.column === index)

      return Math.round(moves[moves.length - 1]!.pose.azimuthDegrees * 1000) / 1000
    })

    expect(ends).toEqual([180, 165, 90, 0, 195, 210, 360])
  })

  it('keeps every step within the axis limit', () => {
    for (let index = 1; index < path.length; index += 1) {
      const turn = axisTurn(path[index - 1]!.pose, path[index]!.pose)

      expect(turn.hourAngle).toBeLessThanOrEqual(settings.legDegrees + 1e-6)
      expect(turn.declination).toBeLessThanOrEqual(settings.legDegrees + 1e-6)
    }
  })

  it('begins at the south meridian at the floor and ends at the north on the west side, above the pole', () => {
    const first = path[0]!
    const last = path[path.length - 1]!

    expect(first.pose.azimuthDegrees).toBe(180)
    expect(first.pose.altitudeDegrees).toBe(2)
    expect(first.flipExpected).toBe(false)
    expect(last.column).toBe(24)
    expect(last.pose.azimuthDegrees).toBeCloseTo(360, 6)
    expect(last.pose.altitudeDegrees).toBeCloseTo(70, 6)
    expect(last.pose.hourAngleDegrees).toBeCloseTo(0, 6)
  })

  it('goes east first on the normal side, and marks the return to the south and the change to the west', () => {
    const east = path.filter(move => move.column <= 12)

    expect(east.every(move => move.kind !== 'return')).toBe(true)
    expect(path.filter(move => move.kind === 'return').every(move => move.column === 13)).toBe(true)
    expect(path.filter(move => move.kind === 'return').length).toBeGreaterThan(0)
    expect(path.filter(move => move.kind === 'join').length).toBeGreaterThan(0)
    expect(east.every(move => move.pose.hourAngleDegrees <= 15 + 1e-6)).toBe(true)
  })

  it('marks a flip exactly where the predicted pier side changes from the move before', () => {
    path.forEach((move, index) => {
      expect(move.flipExpected).toBe(index > 0 && path[index - 1]!.pose.predictedPierSide !== move.pose.predictedPierSide)
    })

    expect(path.filter(move => move.flipExpected).length).toBeGreaterThan(0)
  })

  it('is the same on every call and depends on the latitude only', () => {
    expect(rehearsalPath(phoenix, settings)).toEqual(path)
    expect(rehearsalPath({ latitudeDegrees: phoenix.latitudeDegrees }, settings)).toEqual(path)
    expect(rehearsalPath({ latitudeDegrees: 45 }, settings)).not.toEqual(path)
  })

  it('has the number of moves for the default settings', () => {
    expect(path).toHaveLength(633)
    expect(path.length * 2.5 / 60).toBeCloseTo(26.375, 6)
  })

  it('has more moves for closer columns and fewer for a lower ceiling', () => {
    expect(rehearsalPath(phoenix, { ...settings, rehearsal: { ...settings.rehearsal, columnDegrees: 30 } }).length).toBeLessThan(path.length)
    expect(rehearsalPath(phoenix, { ...settings, ceilingDegrees: 40 }).length).toBeLessThan(path.length)
  })
})

describe('the rehearsal route from where the mount is', () => {
  const path = rehearsalPath(phoenix, settings)
  const far = poseOfAxes({ hourAngleDegrees: 120, declinationDegrees: 80 }, phoenix, settings)
  const route = rehearsalRoute(far, phoenix, settings)

  it('chains legs from the mount to the first pose, then visits the rest of the rehearsal path in order', () => {
    const chain = legs(far, path[0]!.pose, phoenix, settings)

    expect(chain.length).toBeGreaterThan(10)
    expect(route).toHaveLength(chain.length + path.length - 1)
    expect(route.slice(0, chain.length).map(move => move.pose)).toEqual(chain)
    expect(route.slice(chain.length)).toEqual(path.slice(1))
    expect(route[chain.length - 1]!.pose).toEqual(path[0]!.pose)
  })

  it('turns neither axis more than the leg limit from the far-off pose to the end of the rehearsal', () => {
    let previous = far

    for (const move of route) {
      const turn = axisTurn(previous, move.pose)

      expect(turn.hourAngle).toBeLessThanOrEqual(settings.legDegrees + 1e-6)
      expect(turn.declination).toBeLessThanOrEqual(settings.legDegrees + 1e-6)
      previous = move.pose
    }
  })

  it('marks the flip where the chain leaves the flipped side, and nowhere else in the chain', () => {
    const chain = route.slice(0, legs(far, path[0]!.pose, phoenix, settings).length)
    const flips = chain.filter(move => move.flipExpected)

    expect(far.predictedPierSide).toBe('PIER_EAST')
    expect(flips).toHaveLength(1)
    expect(flips[0]!.pose.predictedPierSide).toBe('PIER_WEST')
    expect(route.slice(chain.length).map(move => move.flipExpected)).toEqual(path.slice(1).map(move => move.flipExpected))
  })

  it('is one move to the first pose when the mount is already one leg away, and the whole path when it stands on it', () => {
    const near = poseAt(7, 180, phoenix, settings)

    expect(rehearsalRoute(near, phoenix, settings)).toHaveLength(path.length)
    expect(rehearsalRoute(path[0]!.pose, phoenix, settings)).toHaveLength(path.length)
  })
})
