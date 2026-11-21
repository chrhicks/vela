import { describe, expect, it } from 'vitest'
import { decodeConfig } from '../config.ts'
import { cellCentrePixel, cellLevels, cellOfPixel, countStars, labelOf, ownClearStars } from './cells.ts'
import { CellSettings } from './settings.ts'

const settings = decodeConfig(CellSettings, {})
const size = { width: 800, height: 600 }
const grid = { columns: 8, rows: 6 }

describe('the cell settings', () => {
  it('start at 4 by 3 cells, 15% and 65% of the clear-sky count, and 1 degree bins', () => {
    expect(settings).toEqual({ columns: 4, rows: 3, blockedBelow: 0.15, partlyBlockedBelow: 0.65, clearTopFraction: 0.1, edgeBinDegrees: 1 })
  })

  it('refuse a grid of nothing and a share outside 0 to 1', () => {
    expect(() => decodeConfig(CellSettings, { columns: 0 })).toThrow()
    expect(() => decodeConfig(CellSettings, { blockedBelow: 1.5 })).toThrow()
    expect(() => decodeConfig(CellSettings, { clearTopFraction: 0 })).toThrow()
  })

  it('take a site only with all of latitude, longitude and elevation', () => {
    expect(decodeConfig(CellSettings, { site: { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 } }).site?.latitudeDegrees).toBe(33.45)
    expect(() => decodeConfig(CellSettings, { site: { latitudeDegrees: 33.45 } })).toThrow()
    expect(() => decodeConfig(CellSettings, { site: { latitudeDegrees: 133, longitudeDegrees: 0, elevationMeters: 0 } })).toThrow()
  })
})

describe('which cell a star is in', () => {
  it('numbers the cells across each row from the top left, with star positions counted from 1', () => {
    expect(cellOfPixel({ x: 1, y: 1 }, size, grid)).toBe(0)
    expect(cellOfPixel({ x: 100.9, y: 100.9 }, size, grid)).toBe(0)
    expect(cellOfPixel({ x: 101, y: 1 }, size, grid)).toBe(1)
    expect(cellOfPixel({ x: 1, y: 101 }, size, grid)).toBe(8)
    expect(cellOfPixel({ x: 800, y: 600 }, size, grid)).toBe(47)
  })

  it('keeps a position on the far edge of the frame in the last cell', () => {
    expect(cellOfPixel({ x: 800.5, y: 600.5 }, size, grid)).toBe(47)
    expect(cellOfPixel({ x: 0.5, y: 0.5 }, size, grid)).toBe(0)
  })

  it('counts the stars of each cell', () => {
    const counts = countStars([{ x: 5, y: 5 }, { x: 50, y: 50 }, { x: 790, y: 590 }, { x: 150, y: 5 }], size, grid)

    expect(counts).toHaveLength(48)
    expect([counts[0], counts[1], counts[47]]).toEqual([2, 1, 1])
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4)
  })

  it('puts the centre of a cell in the middle of its pixels', () => {
    expect(cellCentrePixel(0, 0, size, grid)).toEqual({ x: 50.5, y: 50.5 })
    expect(cellCentrePixel(7, 5, size, grid)).toEqual({ x: 750.5, y: 550.5 })
  })
})

describe('the median level of each cell', () => {
  it('is the median pixel of the cell, not the mean, so a bright star does not move it', () => {
    const pixels = new Uint16Array(size.width * size.height).fill(500)

    pixels[10 * size.width + 10] = 60000
    pixels[11 * size.width + 10] = 60000

    expect(cellLevels(pixels, size, grid)[0]).toBe(500)
  })

  it('reads each cell from its own pixels', () => {
    const pixels = new Uint16Array(size.width * size.height)

    for (let y = 0; y < size.height; y += 1) for (let x = 0; x < size.width; x += 1) pixels[y * size.width + x] = y < 300 ? 100 : 900

    const levels = cellLevels(pixels, size, grid)

    expect(levels.slice(0, 24).every(level => level === 100)).toBe(true)
    expect(levels.slice(24).every(level => level === 900)).toBe(true)
  })
})

describe('the clear-sky star count of a frame', () => {
  it('is the median of its best cells, a tenth of them by default', () => {
    const counts = [...Array.from({ length: 5 }, (_, index) => 20 + index), ...Array.from({ length: 43 }, () => 0)]

    expect(ownClearStars(counts, settings)).toBe(22)
  })

  it('is one cell at least', () => {
    expect(ownClearStars([3, 9, 1], settings)).toBe(9)
  })
})

describe('a cell label', () => {
  it('is blocked under 15% of the clear-sky count, partly blocked under 65%, else sky', () => {
    expect(labelOf(2, 20, settings)).toBe('blocked')
    expect(labelOf(3, 20, settings)).toBe('partly blocked')
    expect(labelOf(12, 20, settings)).toBe('partly blocked')
    expect(labelOf(13, 20, settings)).toBe('sky')
    expect(labelOf(40, 20, settings)).toBe('sky')
  })

  it('follows the settings', () => {
    expect(labelOf(8, 20, { blockedBelow: 0.5, partlyBlockedBelow: 0.9 })).toBe('blocked')
  })
})
