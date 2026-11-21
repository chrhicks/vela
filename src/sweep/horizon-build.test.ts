import { describe, expect, it } from 'vitest'
import type { NightName, SweepId } from '../../state/entries.ts'
import { altitudeAt, noHorizon } from '../horizon/horizon.ts'
import { binsOfSweep, mergeSweep, type TimedColumn } from './horizon-build.ts'
import type { Edge } from './edges.ts'

const settings = { columnDegrees: 2.5 }
const at = Date.UTC(2026, 10, 9, 4, 0, 0)
const origin = { sweep: 'sweep-a' as SweepId, night: '2026-11-08' as NightName }
const laterOrigin = { sweep: 'sweep-b' as SweepId, night: '2026-11-09' as NightName }

const column = (azimuthDegrees: number, edgeAltitudeDegrees: number, changes: Partial<TimedColumn> = {}): TimedColumn => ({
  sweep: 'sweep-a' as SweepId,
  column: 0,
  azimuthDegrees,
  edgeAltitudeDegrees,
  how: 'between-frames',
  frames: 3,
  at,
  ...changes,
})

const edge = (bin: number, edgeAltitudeDegrees: number): Edge => ({ bin, azimuthDegrees: bin + 0.5, cells: 10, misfits: 0, how: 'edge', edgeAltitudeDegrees, blockedAltitudeDegrees: edgeAltitudeDegrees - 0.3, skyAltitudeDegrees: edgeAltitudeDegrees + 0.3 })

describe('the bins a sweep gives', () => {
  it('take the cell edge of a bin where it has one, and the edge of the column over it where it has not', () => {
    const bins = binsOfSweep([column(101.25, 12), column(103.75, 14)], [edge(100, 10.5), edge(103, 15.5)], settings)

    expect(bins.find(bin => bin.bin === 100)).toMatchObject({ altitudeDegrees: 10.5, from: 'cells' })
    expect(bins.find(bin => bin.bin === 101)).toMatchObject({ altitudeDegrees: 12, from: 'column' })
    expect(bins.find(bin => bin.bin === 104)).toMatchObject({ altitudeDegrees: 14, from: 'column' })
    expect(bins.find(bin => bin.bin === 103)).toMatchObject({ altitudeDegrees: 15.5, from: 'cells' })
  })

  it('leave a bin with neither as no bin, not as open sky', () => {
    const bins = binsOfSweep([column(101.25, 12)], [], settings)

    expect(bins.map(bin => bin.bin)).toEqual([100, 101, 102])
    expect(bins.map(bin => bin.bin)).not.toContain(110)
  })

  it('treat an open or blocked bin as having no cell edge', () => {
    const open: Edge = { bin: 100, azimuthDegrees: 100.5, cells: 4, misfits: 0, how: 'open', skyAltitudeDegrees: 3 }
    const blocked: Edge = { bin: 101, azimuthDegrees: 101.5, cells: 4, misfits: 0, how: 'blocked', blockedAltitudeDegrees: 40 }
    const bins = binsOfSweep([column(101.25, 12)], [open, blocked], settings)

    expect(bins).toMatchObject([
      { bin: 100, altitudeDegrees: 12, from: 'column' },
      { bin: 101, altitudeDegrees: 12, from: 'column' },
      { bin: 102, altitudeDegrees: 12, from: 'column' },
    ])
  })

  it('give a bin on the border of two columns to the nearer, then to the earlier', () => {
    const bins = binsOfSweep([column(176.25, 9), column(178.75, 11)], [], settings)

    expect(bins.find(bin => bin.bin === 177)?.altitudeDegrees).toBe(9)
    expect(bins.find(bin => bin.bin === 178)?.altitudeDegrees).toBe(11)
  })

  it('wrap a column over north', () => {
    const bins = binsOfSweep([column(358.75, 20), column(1.25, 22)], [], settings)

    expect(bins.map(bin => bin.bin)).toEqual([0, 1, 2, 357, 358, 359])
    expect(bins.find(bin => bin.bin === 359)?.altitudeDegrees).toBe(20)
    expect(bins.find(bin => bin.bin === 0)?.altitudeDegrees).toBe(22)
  })

  it('take no edge from a column that was blocked to the ceiling', () => {
    expect(binsOfSweep([column(101.25, 70, { how: 'blocked-to-ceiling' })], [], settings)).toEqual([])
  })

  it('keep the time of the column over the bin, for a cell edge too', () => {
    const later = at + 60000
    const bins = binsOfSweep([column(101.25, 12), column(103.75, 14, { at: later })], [edge(100, 10.5), edge(103, 15.5)], settings)

    expect(bins.find(bin => bin.bin === 100)?.at).toBe(at)
    expect(bins.find(bin => bin.bin === 103)?.at).toBe(later)
  })

  it('give a cell edge the time of the nearest column when no column spans it', () => {
    const bins = binsOfSweep([column(101.25, 12, { at: at + 5 })], [edge(120, 10)], settings)

    expect(bins.find(bin => bin.bin === 120)).toMatchObject({ from: 'cells', at: at + 5 })
  })

  it('give a cell edge no bin when the sweep has no column at all', () => {
    expect(binsOfSweep([], [edge(120, 10)], settings)).toEqual([])
  })
})

describe('merging a sweep into the horizon file', () => {
  const bins = [
    { bin: 10, altitudeDegrees: 12.5, from: 'cells' as const, at },
    { bin: 11, altitudeDegrees: 13, from: 'column' as const, at: at + 1000 },
  ]

  it('fills the bins the sweep gives, as sweep sources with their time, and leaves the rest unknown', () => {
    const merged = mergeSweep(noHorizon, bins, origin)

    expect(merged.altitudesDegrees[10]).toBe(12.5)
    expect(merged.sources.slice(10, 12)).toEqual(['sweep', 'sweep'])
    expect(merged.observedAt.slice(10, 12)).toEqual(['2026-11-09T04:00:00.000Z', '2026-11-09T04:00:01.000Z'])
    expect(merged.altitudesDegrees.filter(altitude => altitude === null)).toHaveLength(358)
    expect(altitudeAt(merged, 10.5)).toBeCloseTo(12.75, 10)
    expect(altitudeAt(merged, 12.5)).toBeNull()
  })

  it('replaces only the bins the sweep gives and keeps the others, with their sources and times', () => {
    const before = mergeSweep(noHorizon, [{ bin: 11, altitudeDegrees: 20, from: 'column', at: at - 1000 }, { bin: 50, altitudeDegrees: 8, from: 'column', at: at - 1000 }], origin)
    const old = { ...before, sources: before.sources.map((source, bin) => (bin === 50 ? ('old-profile' as const) : source)) }
    const merged = mergeSweep(old, bins, laterOrigin)

    expect(merged.altitudesDegrees[11]).toBe(13)
    expect(merged.altitudesDegrees[50]).toBe(8)
    expect(merged.sources[50]).toBe('old-profile')
    expect(merged.observedAt[50]).toBe(old.observedAt[50])
  })

  it('gives each bin the sweep gave it its origin, and leaves the rest unknown', () => {
    const merged = mergeSweep(noHorizon, bins, origin)

    expect(merged.origins.slice(10, 12)).toEqual([origin, origin])
    expect(merged.origins.filter(given => given === null)).toHaveLength(358)
  })

  it('keeps the origin of a bin it does not replace, and replaces the origin of one it does', () => {
    const before = mergeSweep(noHorizon, [{ bin: 11, altitudeDegrees: 20, from: 'column', at: at - 1000 }, { bin: 50, altitudeDegrees: 8, from: 'column', at: at - 1000 }], origin)
    const merged = mergeSweep(before, bins, laterOrigin)

    expect(merged.origins[10]).toEqual(laterOrigin)
    expect(merged.origins[11]).toEqual(laterOrigin)
    expect(merged.origins[50]).toEqual(origin)
  })

  it('leaves a kept bin of unknown origin unknown', () => {
    const merged = mergeSweep({ ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin === 50 ? 8 : null)) }, bins, origin)

    expect(merged.altitudesDegrees[50]).toBe(8)
    expect(merged.origins[50]).toBeNull()
  })
})
