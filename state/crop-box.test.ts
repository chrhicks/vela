import { describe, expect, it } from 'vitest'
import { boxAround } from './crop-box.ts'

const frame = { width: 6248, height: 4176 }

describe('the box of camera pixels a picture shows at full size', () => {
  it('is as many camera pixels as the picture has, around the point asked', () => {
    expect(boxAround(frame, { width: 448, height: 298.67 }, { x: 0.5, y: 0.5 })).toEqual({ x: 2900, y: 1939, width: 448, height: 299 })
  })

  it('stays inside the frame at its corners and edges', () => {
    expect(boxAround(frame, { width: 141, height: 94 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0, width: 141, height: 94 })
    expect(boxAround(frame, { width: 141, height: 94 }, { x: 1, y: 1 })).toEqual({ x: 6107, y: 4082, width: 141, height: 94 })
    expect(boxAround(frame, { width: 141, height: 94 }, { x: 0.5, y: 1 })).toMatchObject({ x: 3054, y: 4082 })
  })

  it('is the whole frame when the picture is bigger than the frame', () => {
    expect(boxAround({ width: 16, height: 12 }, { width: 448, height: 300 }, { x: 0.3, y: 0.8 })).toEqual({ x: 0, y: 0, width: 16, height: 12 })
  })
})
