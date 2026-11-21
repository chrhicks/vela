import { describe, expect, it } from 'vitest'
import { NightName } from './entries.ts'
import type { HorizonNight } from './horizon-night.ts'
import type { EdgeKind, SweepFramePoint } from './horizon-sweep.ts'
import { frameGroups, framesWords, mapUnavailableWords, treeLinePieces } from './horizon-sweep-view.ts'

const horizonOf = (altitudes: ReadonlyArray<number | null>): HorizonNight['horizon'] => ({
  fileLoaded: true,
  altitudesDegrees: Array.from({ length: 360 }, (_, bin) => altitudes[bin] ?? null),
  sources: Array.from({ length: 360 }, () => null),
  sweepNights: [],
  upLineDegrees: 30,
})

const edgesOf = (kinds: Record<number, EdgeKind>): ReadonlyArray<EdgeKind | null> => Array.from({ length: 360 }, (_, bin) => kinds[bin] ?? null)

describe('the tree line of the tree map', () => {
  it('is solid between bins with a cell edge and dotted where either end has none', () => {
    const horizon = horizonOf([5, 6, 7, 8, 9, 10])
    const pieces = treeLinePieces(horizon, edgesOf({ 0: 'edge', 1: 'edge', 2: 'edge', 3: 'open', 4: 'edge', 5: 'edge' }))

    expect(pieces.map(piece => [piece.dotted, piece.points.map(point => point.azimuthDegrees)])).toEqual([
      [false, [0, 1, 2]],
      [true, [2, 3, 4]],
      [false, [4, 5]],
    ])
    expect(pieces[1]!.points.map(point => point.altitudeDegrees)).toEqual([7, 8, 9])
  })

  it('leaves out bins with no altitude, and starts a new piece after them', () => {
    const pieces = treeLinePieces(horizonOf([5, 6, null, 8, 9]), edgesOf({ 0: 'edge', 1: 'edge', 3: 'edge', 4: 'edge' }))

    expect(pieces.map(piece => piece.points.map(point => point.azimuthDegrees))).toEqual([[0, 1], [3, 4]])
  })

  it('is dotted throughout when no bin has a cell edge, and wraps from the last bin to the first', () => {
    const altitudes = Array.from({ length: 360 }, () => 10)
    const pieces = treeLinePieces(horizonOf(altitudes), edgesOf({}))

    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.dotted).toBe(true)
    expect(pieces[0]!.points).toHaveLength(361)
    expect(treeLinePieces(horizonOf(altitudes), edgesOf(Object.fromEntries(altitudes.map((_, bin) => [bin, 'edge'])))).map(piece => piece.dotted)).toEqual([false])
  })
})

describe('the frames of the tree map', () => {
  const frame = (altitudeDegrees: number, kind: SweepFramePoint['class'], source: SweepFramePoint['source']): SweepFramePoint => ({ altitudeDegrees, azimuthDegrees: altitudeDegrees * 2, source, class: kind })

  it('groups clean and blocked frames apart, and each pointing source apart', () => {
    const groups = frameGroups([frame(1, 'sky', 'solve'), frame(2, 'blocked', 'commanded+offset'), frame(3, 'edge', 'solve'), frame(4, 'blocked', 'commanded'), frame(5, 'blocked', 'commanded+offset')])

    expect(groups.map(group => [group.blocked, group.source, group.points.map(point => point.altitudeDegrees)])).toEqual([
      [false, 'solve', [1, 3]],
      [true, 'commanded+offset', [2, 5]],
      [true, 'commanded', [4]],
    ])
  })
})

describe('the words of the tree map', () => {
  it('names the nights of the frames and what the marks mean', () => {
    expect(framesWords(['2026-11-19', '2026-11-20'])).toBe('11-19, 11-20 frames · + clean ■ blocked · dotted: no cell edge')
  })

  it('say why the map is unavailable, and nothing when it is there', () => {
    const night = NightName.make('2026-11-20')

    expect(mapUnavailableWords({ status: 'unreachable' })).toBe('Tree map unavailable: Vela did not answer')
    expect(mapUnavailableWords({ status: 'read', sweep: { status: 'available', nights: [night], frames: [], edges: [] } })).toBeUndefined()
    expect(mapUnavailableWords({ status: 'read', sweep: { status: 'unavailable', reason: 'no-origins', night: null, file: null } })).toContain('does not say which sweep')
    expect(mapUnavailableWords({ status: 'read', sweep: { status: 'unavailable', reason: 'missing', night, file: 'edges.jsonl' } })).toBe('Tree map unavailable: edges.jsonl of the 11-20 sweep is missing')
    expect(mapUnavailableWords({ status: 'read', sweep: { status: 'unavailable', reason: 'unreadable', night, file: 'frames.jsonl' } })).toContain('frames.jsonl of the 11-20 sweep could not be read')
    expect(mapUnavailableWords({ status: 'read', sweep: { status: 'unavailable', reason: 'no-frames', night, file: 'frames.jsonl' } })).toContain('hold no frames')
    expect(mapUnavailableWords({ status: 'read', sweep: { status: 'unavailable', reason: 'no-edges', night, file: 'edges.jsonl' } })).toContain('hold no cell edges')
  })
})
