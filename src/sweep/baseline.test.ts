import { describe, expect, it } from 'vitest'
import { decodeConfig } from '../config.ts'
import { baselineOf } from './baseline.ts'
import { SweepSettings } from './settings.ts'

const settings = decodeConfig(SweepSettings, {})

const frame = (altitudeDegrees: number, stars: number) => ({ altitudeDegrees, stars })

describe('the baseline star count', () => {
  it('is nothing before any frame has solved', () => {
    expect(baselineOf([], 20, settings)).toBeUndefined()
  })

  it('is the highest star count of any solved frame while fewer than three are within the altitude window', () => {
    expect(baselineOf([frame(20, 400), frame(60, 900)], 22, settings)).toBe(900)
    expect(baselineOf([frame(20, 400), frame(24, 500), frame(60, 900)], 22, settings)).toBe(900)
  })

  it('is the median of the top quarter of the frames within the altitude window', () => {
    const near = [100, 200, 300, 400, 500, 600, 700, 800].map((stars, index) => frame(20 + index, stars))

    expect(baselineOf([...near, frame(60, 5000)], 22, settings)).toBe(750)
  })

  it('takes the single best frame when a quarter of the window is less than one frame', () => {
    expect(baselineOf([frame(20, 100), frame(21, 300), frame(22, 200)], 21, settings)).toBe(300)
  })

  it('leaves out frames further in altitude than the window', () => {
    const solved = [frame(20, 400), frame(21, 420), frame(22, 380), frame(33, 9000)]

    expect(baselineOf(solved, 21, settings)).toBe(420)
  })
})
