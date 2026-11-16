import { describe, expect, it } from 'vitest'
import type { PlateSolution } from '../frames/stats.ts'
import { makeStack, type Binned } from './stack.ts'

const scale = 1 / 3600

const solved = (shiftX: number, shiftY: number): PlateSolution => ({
  centre: { raDegrees: 23.46, decDegrees: 30.65 },
  referencePixel: [40.5 + shiftX, 24.5 + shiftY],
  matrix: [
    [-scale, 0],
    [0, scale],
  ],
})

const cell = 4
const width = 20
const height = 12

function frame(star: { readonly x: number; readonly y: number } | undefined, sky = 100): Binned {
  const plane = new Uint16Array(width * height).fill(sky)

  if (star !== undefined) plane[star.y * width + star.x] = 1000

  return { width, height, cell, planes: [plane, plane, plane] }
}

describe('stacking frames by their plate solutions', () => {
  it('lines a star up across frames that point a little apart, and averages them', () => {
    const stack = makeStack(solved(0, 0), { width, height, cell })

    expect(stack.add(frame({ x: 10, y: 6 }), solved(0, 0))).toBe(true)
    expect(stack.add(frame({ x: 12, y: 5 }), solved(8, -4))).toBe(true)

    const [red] = stack.mean()

    expect(stack.frames).toBe(2)
    expect(red?.[6 * width + 10]).toBe(1000)
    expect(red?.[5 * width + 12]).toBe(100)
  })

  it('keeps the average to the frames that cover each pixel', () => {
    const stack = makeStack(solved(0, 0), { width, height, cell })

    stack.add(frame(undefined, 100), solved(0, 0))
    stack.add(frame(undefined, 300), solved(-40, 0))

    const [red] = stack.mean()

    expect(red?.[6 * width + 2]).toBe(100)
    expect(red?.[6 * width + 16]).toBe(200)
  })

  it('refuses a frame of another size', () => {
    const stack = makeStack(solved(0, 0), { width, height, cell })

    expect(stack.add({ ...frame(undefined), width: 10 }, solved(0, 0))).toBe(false)
    expect(stack.frames).toBe(0)
  })
})
