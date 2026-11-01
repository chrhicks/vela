import { describe, expect, it } from 'vitest'
import { frame, gap, homeOperation, imageIdOf, operationId, snapshot, solved, streamEnded, syntheticSite } from '@vela/rig-testing'
import { fromMount } from '@vela/rig-sky'
import { away, home, inOrder, positions, results, run, s, session, skyAt, steady, tracking } from './support.ts'

const otherInstance = '99999999-9999-4999-8999-999999999999'

const solveOf = (second: number) => fromMount(skyAt(40, 150, new Date(s(second))), 'topocentric', new Date(s(second)), syntheticSite)

const light = (captured: number, exposure: number, solveAt: number, id = 1) => [
  frame({ image: imageIdOf(id), capturedAt: s(captured), exposureSeconds: exposure, seenAt: s(captured + exposure + 1) }),
  solved(imageIdOf(id), solveOf(captured + exposure / 2), s(solveAt)),
]

const knownAt20 = () => inOrder(session(s(-1)), tracking(0, 19, home), light(2, 10, 14))

describe('motion that the readings do not show', () => {
  it('breaks the epoch for a slew that began and ended between two snapshots', () => {
    const missed = snapshot({ at: s(21), mount: { at: s(21), ...home }, operations: [homeOperation({ id: operationId(1), acceptedAt: s(19.5), startedAt: s(19.8), settledAt: s(20.6) })] })
    const { out, model } = run(inOrder(knownAt20(), missed, tracking(22, 90, home), light(15, 30, 47, 2)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'moving:moving', 'uncertain:moved-without-solve'])
    expect(model.epochs.list.map(epoch => [epoch.from, epoch.to])).toEqual([
      [s(0), s(19.8)],
      [s(20.6), null],
    ])
    expect(results(out).at(-1)?.body).toMatchObject({ outcome: 'rejected', reason: 'exposure-spans-epochs' })
  })

  it('stays moving while an operation runs, and settles when it does', () => {
    const running = snapshot({ at: s(20), mount: { at: s(20), ...home }, operations: [homeOperation({ id: operationId(1), acceptedAt: s(19.9), startedAt: s(20) })] })
    const done = snapshot({ at: s(40), mount: { at: s(40), ...home }, operations: [homeOperation({ id: operationId(1), acceptedAt: s(19.9), startedAt: s(20), settledAt: s(39.5) })] })
    const { out, model } = run(inOrder(knownAt20(), running, tracking(21, 39, home), done, tracking(41, 60, home)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'moving:moving', 'uncertain:moved-without-solve'])
    expect(model.epochs.list.at(-1)?.from).toBe(s(39.5))
  })

  it('ends an uncertain operation as uncertain, with a different reason', () => {
    const running = snapshot({ at: s(20), mount: { at: s(20), ...home }, operations: [homeOperation({ id: operationId(1), acceptedAt: s(19.9), startedAt: s(20) })] })
    const done = snapshot({ at: s(40), mount: { at: s(40), ...home }, operations: [homeOperation({ id: operationId(1), acceptedAt: s(19.9), startedAt: s(20), settledAt: s(39.5), outcome: 'uncertain' })] })
    const { out } = run(inOrder(knownAt20(), running, done))

    expect(positions(out).at(-1)).toBe('uncertain:operation-uncertain')
  })

  it('does not treat operations already settled in the first snapshot as motion', () => {
    const first = snapshot({ at: s(0), mount: { at: s(0), ...home }, operations: [homeOperation({ id: operationId(1), acceptedAt: s(-3600), startedAt: s(-3599), settledAt: s(-3500) })] })
    const { out, model } = run(inOrder(session(s(-1)), first, tracking(1, 30, home)))

    expect(positions(out)).toEqual(['unknown:session-start'])
    expect(model.epochs.list).toEqual([{ id: 1, from: s(0), to: null }])
  })

  it('treats a position jump with no slewing and no operation as a move that was missed', () => {
    const { out, model } = run(inOrder(knownAt20(), snapshot({ at: s(20), mount: { at: s(20), ...away } }), tracking(21, 40, away)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'moving:moving', 'uncertain:moved-without-solve'])
    expect(model.epochs.list[0]?.to).toBe(s(19))
  })

  it('does not call a small drift a move', () => {
    const drifted = { raHours: home.raHours + 1 / 60 / 15, decDegrees: home.decDegrees }
    const { out, model } = run(inOrder(knownAt20(), tracking(20, 60, drifted)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved'])
    expect(model.epochs.list).toHaveLength(1)
  })

  it('rejects an exposure that straddles a drift larger than the display step, though it is too small to count as a move', () => {
    const drifted = { raHours: home.raHours + 2 / 60 / 15, decDegrees: home.decDegrees }
    const { out } = run(inOrder(session(s(-1)), tracking(0, 19, home), tracking(20, 90, drifted), light(15, 30, 47)))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'mount-moved-during-exposure' })
  })
})

describe('when Cria restarts', () => {
  const restart = (position: typeof home) => snapshot({ at: s(60), instanceId: otherInstance, mount: { at: s(60), ...position } })

  it('keeps the last fix as uncertain when the mount is where it was and still tracking', () => {
    const { out, model } = run(inOrder(knownAt20(), tracking(20, 59, home), restart(home), tracking(61, 90, home)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:instance-changed'])
    expect(model.mount.value.state === 'uncertain' && model.mount.value.lastFix?.imageId).toBe(imageIdOf(1))
  })

  it('goes to unknown when the mount is somewhere else, which a power cycle would explain', () => {
    const { out } = run(inOrder(knownAt20(), tracking(20, 59, home), restart(away), tracking(61, 90, away)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'unknown:power-cycled'])
  })

  it('rejects an exposure that spans the restart, even though the mount did not move', () => {
    const { out } = run(inOrder(session(s(-1)), tracking(0, 59, home), restart(home), tracking(61, 120, home), light(50, 30, 85)))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'exposure-spans-epochs' })
  })

  it('starts a new epoch at the restart', () => {
    const { model } = run(inOrder(session(s(-1)), tracking(0, 59, home), restart(home)))

    expect(model.epochs.list.map(epoch => [epoch.from, epoch.to])).toEqual([
      [s(0), s(59)],
      [s(60), null],
    ])
  })
})

describe('when the data stops', () => {
  it('becomes uncertain when the stream ends and recovers its epoch with the next snapshot', () => {
    const { out, model } = run(inOrder(knownAt20(), tracking(20, 30, home), streamEnded(s(30.5)), tracking(45, 80, home)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stream-gap'])
    expect(model.epochs.list.map(epoch => [epoch.from, epoch.to])).toEqual([
      [s(0), s(30.5)],
      [s(45), null],
    ])
  })

  it('becomes uncertain when a producer reports dropped facts', () => {
    const { out } = run(inOrder(knownAt20(), tracking(20, 40, home), gap(s(25), s(35), s(36))))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stream-gap'])
  })

  it('becomes uncertain when the mount stops being available, and reads again when it is', () => {
    const lost = snapshot({ at: s(30), lost: true, mount: { at: s(30), ...home } })
    const { out, model } = run(inOrder(knownAt20(), tracking(20, 29, home), lost, tracking(40, 80, home)))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:mount-unavailable'])
    expect(model.epochs.list.at(-1)?.from).toBe(s(40))
  })

  it('becomes uncertain when the stream goes quiet for longer than it should', () => {
    const { out } = run(inOrder(knownAt20(), tracking(20, 30, home)).concat(steady({ from: s(100), to: s(101), mount: { at: 0, ...home } })))

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'uncertain:stream-gap'])
    expect(out.find(draft => draft.kind === 'mount-position' && draft.body.reason === 'stream-gap')?.at).toBe(s(40.02))
  })
})

describe('a new outing', () => {
  it('starts every setup belief over: unknown, no fixes, no pending joins', () => {
    const { model } = run(inOrder(knownAt20(), session(s(25), 'started')))

    expect(model.mount.value).toMatchObject({ state: 'unknown', reason: 'session-start', since: s(25) })
    expect(model.fixes).toEqual([])
    expect(model.mount.scope).toBe('setup')
  })

  it('keeps what belongs to the place', () => {
    const { model } = run(inOrder(knownAt20(), session(s(25), 'started')))

    expect(model.site.scope).toBe('site')
    expect(model.site.value).toMatchObject({ latitudeDegrees: syntheticSite.latitudeDegrees, longitudeDegrees: syntheticSite.longitudeDegrees })
  })

  it('does not look at the sky indoors', () => {
    const { out, model } = run(inOrder(session(s(-1), 'started', 'indoors'), tracking(0, 90, home), light(10, 30, 45)))

    expect(results(out)).toEqual([])
    expect(model.mount.value.state).toBe('unknown')
  })

  it('goes back to the sky when the next outing is outdoors', () => {
    const { model } = run(inOrder(session(s(-10), 'started', 'indoors'), session(s(-1)), tracking(0, 90, home), light(10, 30, 45)))

    expect(model.mount.value.state).toBe('known')
  })
})
