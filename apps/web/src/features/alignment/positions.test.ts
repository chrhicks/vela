import { describe, expect, it } from 'vitest'
import { positionState } from './positions'

describe('positionState', () => {
  it('marks the position being measured, the ones behind it and the ones ahead', () => {
    const view = { active: true, position: 3, solvedPositions: 2, dropped: [] }

    expect([1, 2, 3, 4].map(point => positionState(view, point))).toEqual(['done', 'done', 'current', 'pending'])
  })

  it('marks a dropped position as dropped, never solved', () => {
    const view = { active: true, position: 4, solvedPositions: 2, dropped: [{ position: 3, detail: 'x' }] }

    expect([2, 3, 4].map(point => positionState(view, point))).toEqual(['done', 'dropped', 'current'])
  })

  it('counts every position of a finished sweep, and not the one a stopped run never solved', () => {
    const finished = { active: false, position: 6, solvedPositions: 5, dropped: [{ position: 2, detail: 'x' }] }
    const stopped = { active: false, position: 4, solvedPositions: 3, dropped: [] }

    expect([1, 2, 6].map(point => positionState(finished, point))).toEqual(['done', 'dropped', 'done'])
    expect([3, 4].map(point => positionState(stopped, point))).toEqual(['done', 'pending'])
  })
})
