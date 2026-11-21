import { describe, expect, it } from 'vitest'
import type { CellLabel } from './cells.ts'
import { edgesOf } from './edges.ts'

const settings = { edgeBinDegrees: 1 }
const cell = (azimuthDegrees: number, altitudeDegrees: number, label: CellLabel) => ({ azimuthDegrees, altitudeDegrees, label })

describe('the edge of a bin of azimuth', () => {
  it('is the altitude halfway between the highest blocked cell and the lowest sky cell above it', () => {
    const [edge] = edgesOf([cell(100.2, 10, 'blocked'), cell(100.4, 10.4, 'blocked'), cell(100.5, 10.8, 'partly blocked'), cell(100.6, 11.2, 'sky'), cell(100.7, 11.6, 'sky')], settings)

    expect(edge).toEqual({ bin: 100, azimuthDegrees: 100.5, cells: 5, misfits: 0, how: 'edge', edgeAltitudeDegrees: 10.8, blockedAltitudeDegrees: 10.4, skyAltitudeDegrees: 11.2 })
  })

  it('counts a sky cell below the highest blocked cell, such as a gap between branches, as a misfit', () => {
    const [edge] = edgesOf([cell(5.5, 9, 'sky'), cell(5.5, 10, 'blocked'), cell(5.5, 12, 'blocked'), cell(5.5, 13, 'sky')], settings)

    expect(edge).toMatchObject({ how: 'edge', blockedAltitudeDegrees: 12, skyAltitudeDegrees: 13, edgeAltitudeDegrees: 12.5, misfits: 1 })
  })

  it('puts the cut where the fewest cells are on the wrong side, so one blocked cell high in the sky does not raise the edge', () => {
    const [edge] = edgesOf([cell(30.5, 5, 'blocked'), cell(30.5, 6, 'blocked'), cell(30.5, 7, 'sky'), cell(30.5, 8, 'sky'), cell(30.5, 9, 'blocked'), cell(30.5, 10, 'sky'), cell(30.5, 11, 'sky')], settings)

    expect(edge).toMatchObject({ how: 'edge', edgeAltitudeDegrees: 6.5, blockedAltitudeDegrees: 6, skyAltitudeDegrees: 7, misfits: 1 })
  })

  it('takes the middle of the cuts when several are as good, such as a gap in a wall', () => {
    const [edge] = edgesOf([cell(31.5, 5, 'blocked'), cell(31.5, 6, 'sky'), cell(31.5, 7, 'blocked'), cell(31.5, 8, 'sky')], settings)

    expect(edge).toMatchObject({ how: 'edge', misfits: 1, blockedAltitudeDegrees: 5, skyAltitudeDegrees: 8, edgeAltitudeDegrees: 6.5 })
  })

  it('is open when no cell is blocked', () => {
    const [edge] = edgesOf([cell(50.1, 3, 'sky'), cell(50.2, 3.4, 'sky')], settings)

    expect(edge).toMatchObject({ bin: 50, how: 'open', skyAltitudeDegrees: 3, misfits: 0 })
    expect(edge?.edgeAltitudeDegrees).toBeUndefined()
  })

  it('is blocked when the cells are all blocked, or the blocked ones are the higher', () => {
    const [edge] = edgesOf([cell(50.1, 60, 'blocked'), cell(50.2, 60.4, 'partly blocked'), cell(50.3, 59, 'blocked')], settings)

    expect(edge).toMatchObject({ bin: 50, how: 'blocked', blockedAltitudeDegrees: 60 })
    expect(edge?.edgeAltitudeDegrees).toBeUndefined()
  })

  it('gives no line for a bin whose cells are all partly blocked', () => {
    expect(edgesOf([cell(70.1, 5, 'partly blocked'), cell(70.2, 6, 'partly blocked')], settings)).toEqual([])
  })

  it('takes the cells of every frame that falls in the bin together', () => {
    const [edge] = edgesOf([cell(20.1, 14, 'blocked'), cell(20.9, 14.4, 'blocked'), cell(20.5, 14.8, 'sky'), cell(20.6, 15.2, 'sky')], settings)

    expect(edge).toMatchObject({ cells: 4, blockedAltitudeDegrees: 14.4, skyAltitudeDegrees: 14.8 })
  })

  it('gives one bin for each degree that has cells, in order, wrapping an azimuth of 360 or more to the start', () => {
    const edges = edgesOf([cell(200.5, 5, 'sky'), cell(10.5, 5, 'sky'), cell(360.5, 5, 'sky'), cell(0.2, 5, 'sky'), cell(-0.5, 5, 'sky')], settings)

    expect(edges.map(edge => [edge.bin, edge.cells])).toEqual([[0, 2], [10, 1], [200, 1], [359, 1]])
  })

  it('follows the bin width', () => {
    const edges = edgesOf([cell(1, 5, 'sky'), cell(4, 5, 'sky'), cell(6, 5, 'sky')], { edgeBinDegrees: 5 })

    expect(edges.map(edge => [edge.bin, edge.azimuthDegrees])).toEqual([[0, 2.5], [1, 7.5]])
  })
})
