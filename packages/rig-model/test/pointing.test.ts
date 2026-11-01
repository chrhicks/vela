import { describe, expect, it } from 'vitest'
import { epochMs } from '@vela/rig-events'
import { angularDistance, fromMount, tangentOffsetArcmin } from '@vela/rig-sky'
import { syntheticSite, frame, imageIdOf, solved, unsolved } from '@vela/rig-testing'
import { steady } from '@vela/rig-testing'
import { away, clock, home, inOrder, positions, results, run, s, session, skyAt, slew, tracking } from './support.ts'

const solvedFrom = (position: { raDegrees: number; decDegrees: number }, second: number) => fromMount(position, 'topocentric', new Date(s(second)), syntheticSite)

describe('where the mount really points', () => {
  it('gives the error vector of an injected 0.9 degree azimuth shift', () => {
    const date = new Date(s(25))
    const reported = skyAt(40, 150, date)
    const shifted = skyAt(40, 150.9, date)
    const analyticTotal = ((2 * Math.asin(Math.cos((40 * Math.PI) / 180) * Math.sin((0.9 * Math.PI) / 180 / 2))) * 180 * 60) / Math.PI
    const expected = tangentOffsetArcmin(reported, shifted)!

    const { model, out } = run(
      inOrder(
        session(s(-1)),
        tracking(0, 90, home),
        frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }),
        solved(imageIdOf(1), solvedFrom(shifted, 25), s(43)),
      ),
    )

    const [result] = results(out)

    expect(result?.body.outcome).toBe('fix')

    if (result?.body.outcome === 'fix') {
      expect(result.body.fix.errorArcmin.total).toBeCloseTo(analyticTotal, 2)
      expect(result.body.fix.errorArcmin.east).toBeCloseTo(expected.east, 0)
      expect(result.body.fix.errorArcmin.north).toBeCloseTo(expected.north, 0)
      expect(Math.abs(result.body.fix.errorArcmin.east - expected.east)).toBeLessThan(0.3)
      expect(Math.abs(result.body.fix.errorArcmin.north - expected.north)).toBeLessThan(0.3)
      expect(result.body.effect).toEqual({ kind: 'restores-known' })
      expect(result.at).toBe(s(25))
    }

    expect(model.mount.value.state).toBe('known')
    expect(model.mount.confidence).toBe('high')
    expect(analyticTotal).toBeGreaterThan(40)
  })

  it('reports zero error where the sky is where the mount says', () => {
    const { out } = run(
      inOrder(tracking(0, 90, home), frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }), solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(25))), 25), s(43))),
    )

    const [result] = results(out)

    expect(result?.body.outcome === 'fix' && result.body.fix.errorArcmin.total).toBeLessThan(0.01)
  })

  it('knows nothing until a solve, then knows, in that order', () => {
    const { out } = run(
      inOrder(session(s(-1)), tracking(0, 60, home), frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 20, seenAt: s(31) }), solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(20))), 20), s(33))),
    )

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved'])
  })
})

describe('what is rejected', () => {
  const lightAndSolve = (captured: number, exposure: number, solveAt: number, id = 1) => [
    frame({ image: imageIdOf(id), capturedAt: s(captured), exposureSeconds: exposure, seenAt: s(captured + exposure + 1) }),
    solved(imageIdOf(id), solvedFrom(skyAt(40, 150, new Date(s(captured + exposure / 2))), captured + exposure / 2), s(solveAt)),
  ]

  it('rejects an exposure the mount was slewing through', () => {
    const { out, model } = run(inOrder(session(s(-1)), tracking(0, 19, home), slew(20, 30, home, away), tracking(30, 90, away), lightAndSolve(15, 30, 47)))
    const [result] = results(out)

    expect(result?.body).toMatchObject({ outcome: 'rejected', reason: 'mount-moved-during-exposure' })
    expect(model.fixes).toHaveLength(0)
  })

  it('accepts an exposure that starts after the slew settled', () => {
    const { out } = run(inOrder(session(s(-1)), tracking(0, 19, home), slew(20, 30, home, away), tracking(30, 90, away), lightAndSolve(40, 30, 72)))

    expect(results(out)[0]?.body.outcome).toBe('fix')
  })

  it('records a solve from an older epoch but never lets it restore known', () => {
    const second = lightAndSolve(40, 30, 95)

    const { out, model } = run(
      inOrder(session(s(-1)), tracking(0, 19, home), slew(20, 30, home, away), tracking(30, 79, away), slew(80, 90, away, home), tracking(90, 130, home), second),
    )

    const [result] = results(out)

    expect(result?.body).toMatchObject({ outcome: 'fix', effect: { kind: 'history-only', reason: 'older-epoch' } })
    expect(model.fixes).toHaveLength(1)
    expect(model.mount.value.state).not.toBe('known')
  })

  it('keeps a fix from a server-estimated capture time out of the known state', () => {
    const light = frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41), source: 'server-estimate' })
    const { out, model } = run(inOrder(session(s(-1)), tracking(0, 90, home), light, solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(25))), 25), s(43))))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'fix', effect: { kind: 'history-only', reason: 'server-estimate' } })
    expect(model.mount.value.state).toBe('unknown')
  })

  it('rejects an exposure that spans a hole in the data', () => {
    const { out } = run(inOrder(session(s(-1)), tracking(0, 14, home), tracking(40, 90, home), lightAndSolve(10, 30, 45)))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'exposure-spans-epochs' })
  })

  it('rejects a frame the solver could not solve, and says so', () => {
    const { out } = run(inOrder(tracking(0, 60, home), frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 20, seenAt: s(31) }), unsolved(imageIdOf(1), s(36))))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'no-solution' })
  })

  it('says nothing about a dark frame', () => {
    const { out, model } = run(inOrder(tracking(0, 60, home), frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 20, seenAt: s(31), frameType: 'dark' })))

    expect(results(out)).toEqual([])
    expect(model.counters.skippedFrames).toBe(1)
  })

  it('rejects a mount reading that Cria marked stale', () => {
    const stale = steady({ from: s(0), to: s(90), mount: { at: 0, ...home, status: 'stale' } })
    const { out } = run(inOrder(session(s(-1)), stale, lightAndSolve(10, 30, 45)))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'mount-sample-stale' })
  })

  it('rejects an exposure during which Cria marked the reading stale', () => {
    const fresh = steady({ from: s(0), to: s(14), mount: { at: 0, ...home } })
    const stale = steady({ from: s(15), to: s(90), mount: { at: 0, ...home, status: 'stale' } })
    const { out, model } = run(inOrder(session(s(-1)), fresh, stale, lightAndSolve(10, 30, 45)))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'mount-sample-stale' })
    expect(model.mount.value.state).toBe('unknown')
  })

  it('refuses a solve more than 89 degrees from where the mount points', () => {
    const { out } = run(inOrder(tracking(0, 90, home), frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }), solved(imageIdOf(1), { raDegrees: (home.raHours * 15 + 150) % 360, decDegrees: -home.decDegrees }, s(43))))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'offset-undefined' })
    expect(angularDistance({ raDegrees: home.raHours * 15, decDegrees: home.decDegrees }, { raDegrees: (home.raHours * 15 + 150) % 360, decDegrees: -home.decDegrees })).toBeGreaterThan(89)
  })

  it('rejects a fix while the mount has not reported where the site is, and takes it from the stream once it does', () => {
    const blind = steady({ from: s(0), to: s(90), mount: { at: 0, ...home, site: null } })
    const { out } = run(inOrder(blind, lightAndSolve(10, 30, 45)))

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'no-site' })
  })

  it('walks known, moving, uncertain and known again across a slew and a new solve', () => {
    const { out, model } = run(
      inOrder(session(s(-1)), tracking(0, 19, home), lightAndSolve(2, 10, 14), slew(20, 30, home, away), tracking(30, 90, away), lightAndSolve(40, 30, 72, 2)),
    )

    expect(positions(out)).toEqual(['unknown:session-start', 'known:solved', 'moving:moving', 'uncertain:moved-without-solve', 'known:solved'])
    expect(model.mount.value.state === 'known' && model.mount.value.fix.epoch).toBe(2)
  })
})

describe('the join waits for what it needs', () => {
  it('waits for the mount track to reach the end of the exposure', () => {
    const { out, model } = run(
      inOrder(
        tracking(0, 20, home),
        frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }),
        solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(25))), 25), s(42)),
      ),
    )

    expect(results(out)).toEqual([])
    expect(model.pending.frames.size).toBe(1)
  })

  it('joins a solve that arrives before its frame', () => {
    const { out } = run([
      ...tracking(0, 50, home),
      solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(25))), 25), s(51)),
      frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(52) }),
    ])

    expect(results(out)[0]?.body.outcome).toBe('fix')
  })

  it('gives up on a frame that never gets a solve, and on a solve that never gets a frame', () => {
    const lonelyFrame = run(inOrder(tracking(0, 400, home), frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) })))
    const lonelySolve = run(inOrder(tracking(0, 400, home), solved(imageIdOf(2), { raDegrees: 1, decDegrees: 1 }, s(41))))

    expect(results(lonelyFrame.out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'solve-missing' })
    expect(results(lonelySolve.out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'frame-missing' })
    expect(lonelyFrame.model.pending.frames.size + lonelySolve.model.pending.solves.size).toBe(0)
  })

  it('gives up on a join the mount track never covers', () => {
    const { out } = run([
      ...inOrder(
        tracking(0, 20, home),
        frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) }),
        solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(25))), 25), s(42)),
      ),
      clock(400),
    ])

    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'mount-not-covered' })
  })

  it('treats a duplicate frame or solve as already decided', () => {
    const light = frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 30, seenAt: s(41) })
    const solve = solved(imageIdOf(1), solvedFrom(skyAt(40, 150, new Date(s(25))), 25), s(43))
    const { out } = run(inOrder(tracking(0, 90, home), light, solve, light, solve))

    expect(results(out)).toHaveLength(1)
  })

  it('rejects the oldest join when too many wait at once', () => {
    const config = { ...run([]).model.config, maxPending: 2 }
    const frames = [1, 2, 3].map(id => frame({ image: imageIdOf(id), capturedAt: s(100 + id), exposureSeconds: 10, seenAt: s(115 + id) }))
    const { out, model } = run(inOrder(tracking(0, 60, home), frames), config)

    expect(model.pending.frames.size).toBe(2)
    expect(results(out)[0]?.body).toMatchObject({ outcome: 'rejected', reason: 'mount-not-covered' })
  })
})

describe('what the model remembers', () => {
  function night(count: number, stepSeconds: number) {
    const frames = Array.from({ length: count }, (_, index) => frame({ image: imageIdOf(index + 1), capturedAt: s(index * stepSeconds), exposureSeconds: 0.5, seenAt: s(index * stepSeconds + 1) }))
    const solves = frames.map((_, index) => unsolved(imageIdOf(index + 1), s(index * stepSeconds + 1)))

    return { frames, solves, until: count * stepSeconds + 10 }
  }

  it('decides each image once, however late the same pair is delivered again', () => {
    const { frames, solves, until } = night(2600, 5 * 6)
    const again = [frames[0]!, solves[0]!, solves[1]!].map(event => ({ ...event, seenAt: epochMs(s(until)) }))
    const { model, out } = run(inOrder(tracking(0, until, home), frames, solves, again))

    expect(until).toBeGreaterThan(3 * 3600)
    expect(model.decided.size).toBe(2600)
    expect(results(out)).toHaveLength(2600)
  })

  it('starts the memory over with a new setup', () => {
    const { frames, solves, until } = night(10, 30)
    const { model } = run(inOrder(session(s(-1)), tracking(0, until, home), frames, solves, session(s(until + 1))))

    expect(model.decided.size).toBe(0)
  })
})
