import { describe, expect, it } from 'vitest'
import { frame, imageIdOf, solved, syntheticSite } from '@vela/rig-testing'
import type { RigEvent } from '@vela/rig-events'
import { fromMount } from '@vela/rig-sky'
import { away, baseConfig, home, inOrder, run, s, session, skyAt, slew, tracking } from './support.ts'

const solveOf = (second: number, azimuth = 150) => fromMount(skyAt(40, azimuth, new Date(s(second))), 'topocentric', new Date(s(second)), syntheticSite)

function light(id: number, captured: number, exposure: number, solveAt: number, azimuth = 150): RigEvent[] {
  return [
    frame({ image: imageIdOf(id), capturedAt: s(captured), exposureSeconds: exposure, seenAt: s(captured + exposure + 1) }),
    solved(imageIdOf(id), solveOf(captured + exposure / 2, azimuth), s(solveAt)),
  ]
}

const night = () =>
  inOrder(
    session(s(-1)),
    tracking(0, 19, home),
    light(1, 2, 10, 14, 150.2),
    slew(20, 30, home, away),
    tracking(30, 89, away),
    light(2, 40, 30, 73, 150.5),
    light(3, 15, 30, 49),
    slew(90, 100, away, home),
    tracking(100, 200, home),
    light(4, 110, 30, 144, 150.9),
  )

function prng(seed: number) {
  let state = seed

  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const isJoinInput = (event: RigEvent) => event.kind === 'frame' || event.kind === 'solve'

function jitter(events: readonly RigEvent[], seed: number, windowMs: number): RigEvent[] {
  const shuffled = [...events]
  const next = prng(seed)

  for (let turn = 0; turn < events.length * 3; turn++) {
    const at = Math.floor(next() * (shuffled.length - 1))
    const [a, b] = [shuffled[at], shuffled[at + 1]]

    if (!a || !b || !(isJoinInput(a) || isJoinInput(b)) || !(isJoinInput(a) || a.kind === 'cria.state') || !(isJoinInput(b) || b.kind === 'cria.state')) continue

    if (Math.abs(a.seenAt - b.seenAt) < windowMs) [shuffled[at], shuffled[at + 1]] = [b, a]
  }

  return shuffled
}

function scatter(events: readonly RigEvent[], seed: number): RigEvent[] {
  const next = prng(seed)
  const stream = events.filter(event => !isJoinInput(event))
  const joins = events.filter(isJoinInput)
  const placed: { event: RigEvent; key: number }[] = stream.map((event, index) => ({ event, key: index }))

  for (const join of joins) placed.push({ event: join, key: next() * stream.length })

  return placed.sort((a, b) => a.key - b.key).map(item => item.event)
}

function summary(events: readonly RigEvent[], keepEffect: boolean, config = baseConfig) {
  const { model, out } = run(events, config)

  const fixes = out
    .flatMap(draft => (draft.kind === 'pointing-fix' ? [draft] : []))
    .map(draft => JSON.stringify({ at: draft.at, body: keepEffect || draft.body.outcome !== 'fix' ? draft.body : { ...draft.body, effect: null } }))
    .sort()

  return { fixes, mount: JSON.stringify(model.mount.value), epochs: JSON.stringify(model.epochs.list), pending: model.pending.frames.size + model.pending.solves.size }
}

describe('the order frames, solves and snapshots arrive in', () => {
  const reference = summary(night(), true)

  it('has a night worth shuffling: two good fixes, a slewing rejection and an older-epoch kind of ending', () => {
    expect(reference.fixes).toHaveLength(4)
    expect(reference.fixes.filter(fix => fix.includes('"outcome":"rejected"'))).toHaveLength(1)
    expect(reference.pending).toBe(0)
  })

  it('gives identical fixes, effects, epochs and final position under delivery jitter', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const shuffled = jitter(night(), seed, 3000)

      expect(summary(shuffled, true), `seed ${seed}`).toEqual(reference)
    }
  })

  it('actually reorders something under that jitter', () => {
    const changed = Array.from({ length: 60 }, (_, index) => jitter(night(), index + 1, 3000)).filter(shuffled => shuffled.some((event, index) => event.id !== night()[index]?.id))

    expect(changed.length).toBeGreaterThan(30)
  })

  const patient = { ...baseConfig, joinExpiryMs: 24 * 3_600_000 }

  it('gives identical error vectors and rejections wherever frames and solves land among the snapshots, while no join has expired', () => {
    const base = summary(night(), false, patient)

    for (let seed = 1; seed <= 60; seed++) expect(summary(scatter(night(), seed), false, patient).fixes, `seed ${seed}`).toEqual(base.fixes)
  })

  it('reaches the same epochs and the same position state wherever the join inputs land', () => {
    const base = summary(night(), false, patient)

    for (let seed = 1; seed <= 60; seed++) {
      const result = summary(scatter(night(), seed), false, patient)

      expect(result.epochs, `seed ${seed}`).toEqual(base.epochs)
      expect(JSON.parse(result.mount).state, `seed ${seed}`).toBe(JSON.parse(base.mount).state)
    }
  })
})
