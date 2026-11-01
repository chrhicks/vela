import { describe, expect, it } from 'vitest'
import { epochMs } from '@vela/rig-events'
import { imageIdOf } from '@vela/rig-testing'
import {
  confidenceOf,
  nextMount,
  type MountInput,
  type MountInputKind,
  type MountPosition,
  type MountState,
  type PointingFix,
} from '@vela/rig-model'

const at = (offset: number) => epochMs(1_000_000 + offset)

function fixAt(offset: number, id = 1): PointingFix {
  return {
    imageId: imageIdOf(id),
    exposure: { from: at(offset - 15_000), to: at(offset + 15_000) },
    at: at(offset),
    epoch: 1,
    errorArcmin: { east: 1, north: 2, total: Math.hypot(1, 2) },
    timeTrust: 'camera',
    pierSide: 'east',
    reportedJ2000: { raDegrees: 10, decDegrees: 20 },
    solvedJ2000: { raDegrees: 10.01, decDegrees: 20.01 },
  }
}

const earlier = fixAt(0, 1)

const later = fixAt(60_000, 2)

const positions: Record<MountState, MountPosition> = {
  unknown: { state: 'unknown', since: at(0), reason: 'never-solved' },
  known: { state: 'known', since: at(0), fix: earlier },
  moving: { state: 'moving', since: at(10), before: { state: 'known', since: at(0), fix: earlier } },
  uncertain: { state: 'uncertain', since: at(10), reason: 'moved-without-solve', lastFix: earlier },
}

const inputs: Record<MountInputKind, MountInput> = {
  moved: { t: 'moved', at: at(100) },
  settled: { t: 'settled', at: at(100), how: 'confirmed' },
  'continuity-lost': { t: 'continuity-lost', at: at(100), why: 'stream-gap' },
  fix: { t: 'fix', at: at(100), fix: later },
  expired: { t: 'expired', at: at(100) },
  'session-start': { t: 'session-start', at: at(100) },
  'power-cycled': { t: 'power-cycled', at: at(100) },
}

function show(position: MountPosition): string {
  switch (position.state) {
    case 'unknown':
      return `unknown:${position.reason}`
    case 'known':
      return `known:${position.fix.imageId.slice(-1)}`
    case 'uncertain':
      return `uncertain:${position.reason}`
    case 'moving':
      return `moving>${show(position.before)}`
  }
}

const expected: Record<MountState, Record<MountInputKind, string>> = {
  unknown: {
    moved: 'moving>unknown:never-solved',
    settled: 'unknown:never-solved',
    'continuity-lost': 'unknown:never-solved',
    fix: 'known:2',
    expired: 'unknown:never-solved',
    'session-start': 'unknown:session-start',
    'power-cycled': 'unknown:power-cycled',
  },
  known: {
    moved: 'moving>known:1',
    settled: 'known:1',
    'continuity-lost': 'uncertain:stream-gap',
    fix: 'known:2',
    expired: 'uncertain:stale',
    'session-start': 'unknown:session-start',
    'power-cycled': 'unknown:power-cycled',
  },
  moving: {
    moved: 'moving>known:1',
    settled: 'uncertain:moved-without-solve',
    'continuity-lost': 'moving>uncertain:stream-gap',
    fix: 'moving>known:1',
    expired: 'moving>known:1',
    'session-start': 'unknown:session-start',
    'power-cycled': 'unknown:power-cycled',
  },
  uncertain: {
    moved: 'moving>uncertain:moved-without-solve',
    settled: 'uncertain:moved-without-solve',
    'continuity-lost': 'uncertain:moved-without-solve',
    fix: 'known:2',
    expired: 'uncertain:moved-without-solve',
    'session-start': 'unknown:session-start',
    'power-cycled': 'unknown:power-cycled',
  },
}

function statesOf(): MountState[] {
  // SAFETY: `expected` is a record keyed by every MountState.
  return Object.keys(expected) as MountState[]
}

function inputKindsOf(state: MountState): MountInputKind[] {
  // SAFETY: each row of `expected` is a record keyed by every MountInputKind.
  return Object.keys(expected[state]) as MountInputKind[]
}

describe('nextMount', () => {
  for (const state of statesOf())
    for (const kind of inputKindsOf(state))
      it(`${state} + ${kind}`, () => {
        expect(show(nextMount(positions[state], inputs[kind]))).toBe(expected[state][kind])
      })

  it('stamps a transition with the time of its input', () => {
    expect(nextMount(positions.known, inputs['continuity-lost']).since).toBe(at(100))
    expect(nextMount(positions.known, inputs.moved).since).toBe(at(100))
  })

  it('keeps the last fix when a known position becomes uncertain', () => {
    const next = nextMount(positions.known, inputs.expired)

    expect(next.state === 'uncertain' && next.lastFix).toBe(earlier)
  })

  it('never invents knowledge: a move that began unknown ends unknown, whichever way it ends', () => {
    const moving = nextMount(positions.unknown, inputs.moved)

    expect(show(nextMount(moving, { t: 'settled', at: at(200), how: 'confirmed' }))).toBe('unknown:never-solved')
    expect(show(nextMount(moving, { t: 'settled', at: at(200), how: 'uncertain' }))).toBe('unknown:never-solved')
  })

  it('says the operation was uncertain when a move from a known position ends that way', () => {
    expect(show(nextMount(positions.moving, { t: 'settled', at: at(200), how: 'uncertain' }))).toBe('uncertain:operation-uncertain')
  })

  it('does not let an older fix replace a newer one', () => {
    const current: MountPosition = { state: 'known', since: at(0), fix: later }

    expect(nextMount(current, { t: 'fix', at: at(100), fix: earlier })).toBe(current)
  })

  it('degrades what a moving mount was, so the way out is honest about the gap', () => {
    const next = nextMount(positions.moving, inputs['continuity-lost'])

    expect(next.state === 'moving' && next.before.state).toBe('uncertain')
    expect(nextMount(next, { t: 'settled', at: at(300), how: 'confirmed' }).state).toBe('uncertain')
  })

  it('maps each state to a confidence: only a solved position is high', () => {
    expect(Object.values(positions).map(confidenceOf)).toEqual(['none', 'high', 'none', 'low'])
  })
})
