import { describe, expect, it } from 'vitest'
import { frame, imageIdOf, solved, syntheticSite } from '@vela/rig-testing'
import { epochMs, type RigEvent } from '@vela/rig-events'
import { fromMount } from '@vela/rig-sky'
import type { ModelInput } from '@vela/rig-model'
import { clock, home, inOrder, positions, results, run, s, session, skyAt, tracking, baseConfig } from './support.ts'

const minutes = (count: number) => count * 60

const solveOf = (second: number) => fromMount(skyAt(40, 150, new Date(s(second))), 'topocentric', new Date(s(second)), syntheticSite)

const fixAt25 = () => [
  frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }),
  solved(imageIdOf(1), solveOf(25), s(43)),
]

function withTicks(events: readonly RigEvent[], everySeconds: number | null, until: number): ModelInput[] {
  if (everySeconds === null) return [...events]

  const ticks: ModelInput[] = []

  for (let second = 0; second <= until; second += everySeconds) ticks.push(clock(second))

  return [...events, ...ticks].map((input, index) => ({ input, index })).sort((a, b) => (a.input.kind === 'clock' ? a.input.at : a.input.seenAt) - (b.input.kind === 'clock' ? b.input.at : b.input.seenAt) || a.index - b.index).map(item => item.input)
}

describe('a known position goes stale on the clock', () => {
  const events = inOrder(session(s(-1)), tracking(0, minutes(32), home), fixAt25())

  it('expires exactly when the fix is old enough, stamped at that moment', () => {
    const { out, model } = run(events)
    const stale = out.find(draft => draft.kind === 'mount-position' && draft.body.reason === 'stale')

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stale'])
    expect(stale?.at).toBe(epochMs(s(25) + baseConfig.knownMaxAgeMs))
    expect(stale?.seenAt).toBe(stale?.at)
    expect(model.mount.value.state === 'uncertain' && model.mount.value.lastFix?.imageId).toBe(imageIdOf(1))
  })

  it('does the same whether a live run ticked every second, every seven seconds, or never', () => {
    const replay = run(withTicks(events, null, 0)).out
    const everySecond = run(withTicks(events, 1, minutes(32))).out
    const everySeven = run(withTicks(events, 7, minutes(32))).out

    expect(everySecond).toEqual(replay)
    expect(everySeven).toEqual(replay)
  })

  it('does not expire before it is due', () => {
    const { model } = run(inOrder(session(s(-1)), tracking(0, minutes(29), home), fixAt25()))

    expect(model.mount.value.state).toBe('known')
  })

  it('learns a position again from the next solve', () => {
    const second = [
      frame({ image: imageIdOf(2), capturedAt: s(minutes(31)), exposureSeconds: 30, seenAt: s(minutes(31) + 31) }),
      solved(imageIdOf(2), solveOf(minutes(31) + 15), s(minutes(31) + 33)),
    ]

    const { out, model } = run(inOrder(session(s(-1)), tracking(0, minutes(33), home), fixAt25(), second))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stale', 'known:solved'])
    expect(model.mount.value.state === 'known' && model.mount.value.fix.imageId).toBe(imageIdOf(2))
  })

  it('records a solve that arrives after its position went stale, without restoring known', () => {
    const late = [
      frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }),
      solved(imageIdOf(1), solveOf(25), s(minutes(40))),
    ]

    const { out, model } = run(inOrder(session(s(-1)), tracking(0, minutes(41), home), late), { ...baseConfig, joinExpiryMs: minutes(60) * 1000 })

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'fix', effect: { kind: 'history-only', reason: 'expired' } })
    expect(model.mount.value.state).toBe('unknown')
  })
})

describe('a quiet stream is noticed on the clock', () => {
  const events = inOrder(session(s(-1)), tracking(0, 45, home), fixAt25())
  const late = inOrder(tracking(100, 101, home))

  it('opens the gap when the silence became too long, whatever ticked since', () => {
    const replay = run([...events, ...late]).out
    const live = run(withTicks(events, 3, 99).concat(late)).out

    expect(live).toEqual(replay)
    expect(positions(replay)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stream-gap'])
  })

  it('notices with a clock alone and no later snapshot', () => {
    const { out } = run([...events, clock(60)])

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stream-gap'])
  })
})

describe('a join that straddles its own deadline', () => {
  const light = frame({ image: imageIdOf(1), capturedAt: s(0), exposureSeconds: 8, seenAt: s(9) })
  const late = solved(imageIdOf(1), solveOf(4), s(128.5))
  const snapshots = inOrder(session(s(-1)), tracking(0, 127, home), tracking(129, 140, home))
  const base = [light, ...snapshots, late]

  it('gives the same answer with no clock, a clock on the deadline, or a clock every second', () => {
    const none = run(inOrder(base))
    const onDeadline = run(inOrder(base).flatMap(input => (input === late ? [clock(128), input] : [input])))
    const everySecond = run(withTicks(inOrder(base), 1, 140))

    for (const result of [none, onDeadline, everySecond]) {
      expect(results(result.out).map(draft => draft.body)).toMatchObject([{ outcome: 'rejected', reason: 'solve-missing' }])
      expect(result.model.mount.value.state).toBe('unknown')
    }
  })

  it('still joins a solve that arrives just inside the deadline', () => {
    const inside = solved(imageIdOf(1), solveOf(4), s(127.5))
    const { out } = run(inOrder(session(s(-1)), tracking(0, 140, home), light, inside))

    expect(results(out)[0]?.body.outcome).toBe('fix')
  })
})

describe('what a late delivery may not do', () => {
  it('does not restore a position that had already expired by the time the pair was delivered', () => {
    const delayed = [frame({ image: imageIdOf(1), capturedAt: s(0), exposureSeconds: 8, seenAt: s(9) }), solved(imageIdOf(1), solveOf(4), s(10))]
    const { out, model } = run([...inOrder(session(s(-1)), tracking(0, 1901, home)), ...delayed], { ...baseConfig, joinExpiryMs: 3_600_000 })

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'fix', effect: { kind: 'history-only', reason: 'expired' } })
    expect(model.mount.value.state).toBe('unknown')
  })

  it('takes seenAt as arrival on the stream\'s clock: a pair stamped long after the stream is not a live arrival', () => {
    const imported = [frame({ image: imageIdOf(1), capturedAt: s(0), exposureSeconds: 8, seenAt: s(86_400) }), solved(imageIdOf(1), solveOf(4), s(86_400))]
    const { out } = run(inOrder(session(s(-1)), tracking(0, 20, home), imported))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'solve-missing' })
  })
})
