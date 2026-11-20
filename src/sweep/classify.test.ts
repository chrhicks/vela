import { describe, expect, it } from 'vitest'
import { decodeConfig } from '../config.ts'
import { baselineOf, classify } from './classify.ts'
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

describe('the class of a frame', () => {
  it('is sky when it solved and blocked when it did not, with no baseline', () => {
    expect(classify({ solved: true, stars: 300 }, undefined, settings)).toBe('sky')
    expect(classify({ solved: false, stars: 300 }, undefined, settings)).toBe('blocked')
  })

  it('is blocked under the blocked fraction of the baseline, solved or not', () => {
    expect(classify({ solved: false, stars: 149 }, 1000, settings)).toBe('blocked')
    expect(classify({ solved: true, stars: 149 }, 1000, settings)).toBe('blocked')
  })

  it('is sky when it solved with at least the sky fraction of the baseline', () => {
    expect(classify({ solved: true, stars: 650 }, 1000, settings)).toBe('sky')
    expect(classify({ solved: true, stars: 2000 }, 1000, settings)).toBe('sky')
  })

  it('is the edge between the two, and when it has the stars but did not solve', () => {
    expect(classify({ solved: true, stars: 400 }, 1000, settings)).toBe('edge')
    expect(classify({ solved: false, stars: 150 }, 1000, settings)).toBe('edge')
    expect(classify({ solved: false, stars: 900 }, 1000, settings)).toBe('edge')
  })
})
