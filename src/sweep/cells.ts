import { Schema } from 'effect'
import type { CellSettings } from './settings.ts'

export interface Grid {
  readonly columns: number
  readonly rows: number
}

export interface FrameSize {
  readonly width: number
  readonly height: number
}

export interface StarPosition {
  readonly x: number
  readonly y: number
}

export const CellLabel = Schema.Literals(['sky', 'partly blocked', 'blocked'])

export type CellLabel = typeof CellLabel.Type

export const cellCount = (grid: Grid) => grid.columns * grid.rows

export const cellIndex = (column: number, row: number, grid: Grid) => row * grid.columns + column

export const cellColumn = (index: number, grid: Grid) => index % grid.columns

export const cellRow = (index: number, grid: Grid) => Math.floor(index / grid.columns)

const clamp = (value: number, upper: number) => Math.max(0, Math.min(upper, value))

export function cellOfPixel(position: StarPosition, size: FrameSize, grid: Grid): number {
  const column = clamp(Math.floor(((position.x - 1) / size.width) * grid.columns), grid.columns - 1)
  const row = clamp(Math.floor(((position.y - 1) / size.height) * grid.rows), grid.rows - 1)

  return cellIndex(column, row, grid)
}

export function cellCentrePixel(column: number, row: number, size: FrameSize, grid: Grid): StarPosition {
  return { x: ((column + 0.5) * size.width) / grid.columns + 0.5, y: ((row + 0.5) * size.height) / grid.rows + 0.5 }
}

export function countStars(stars: ReadonlyArray<StarPosition>, size: FrameSize, grid: Grid): ReadonlyArray<number> {
  const counts = new Array<number>(cellCount(grid)).fill(0)

  for (const star of stars) counts[cellOfPixel(star, size, grid)]! += 1

  return counts
}

export function cellLevels(pixels: Uint16Array, size: FrameSize, grid: Grid): ReadonlyArray<number> {
  const histogram = new Uint32Array(65536)
  const levels: Array<number> = []

  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const [left, right] = [Math.floor((column * size.width) / grid.columns), Math.floor(((column + 1) * size.width) / grid.columns)]
      const [top, bottom] = [Math.floor((row * size.height) / grid.rows), Math.floor(((row + 1) * size.height) / grid.rows)]

      histogram.fill(0)

      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) histogram[pixels[y * size.width + x]!]! += 1

      const middle = ((right - left) * (bottom - top) + 1) / 2
      let seen = 0
      let level = 0

      while (level < histogram.length - 1) {
        seen += histogram[level]!
        if (seen >= middle) break
        level += 1
      }

      levels.push(level)
    }
  }

  return levels
}

const median = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function ownClearStars(counts: ReadonlyArray<number>, settings: Pick<CellSettings, 'clearTopFraction'>): number {
  const best = [...counts].sort((a, b) => b - a).slice(0, Math.max(1, Math.ceil(counts.length * settings.clearTopFraction)))

  return median(best)
}

export function labelOf(stars: number, clearStars: number, settings: Pick<CellSettings, 'blockedBelow' | 'partlyBlockedBelow'>): CellLabel {
  if (clearStars <= 0 || stars < clearStars * settings.blockedBelow) return 'blocked'
  if (stars < clearStars * settings.partlyBlockedBelow) return 'partly blocked'

  return 'sky'
}
