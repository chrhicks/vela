import { expect, it } from 'vitest'
import { rigId, sourceId } from '@vela/rig-events'
import { assess, blindErrorArcminPerDegree, createModel, defaultConfig, step, type RigModel } from '@vela/rig-model'
import { frame, imageIdOf, solved, homeOperation, operationId, snapshot, session } from '@vela/rig-testing'
import { motion } from '../../rig-events/test/motion-sample.ts'
import { run, inOrder, tracking, home, s, clock, slew, away } from './support.ts'

function fixed(): RigModel {
  return run(inOrder(
    tracking(0, 10, { raHours: 2, decDegrees: 0 }),
    frame({ image: imageIdOf(1), capturedAt: s(1), exposureSeconds: 2, seenAt: s(3) }),
    solved(imageIdOf(1), { raDegrees: 30, decDegrees: 0 }, s(4)),
  )).model
}

it('has no pointing budget until there is a fix', () => {
  expect(assess(createModel(defaultConfig(rigId('test'), sourceId('test'))))).toMatchObject({
    confidence: 'none', budgetArcmin: Infinity, lastFix: null, blindTravelDegrees: 0,
  })
})

it('grows by the path, including a reversal, and caps confidence while moving', () => {
  let model = fixed()
  const initial = assess(model)

  for (const [second, raHours] of [[13, 3], [16, 2]] as const) {
    model = step(model, snapshot({ at: s(second), mount: { at: s(second), raHours, decDegrees: 0, slewing: true } })).model
  }

  expect(assess(model)).toMatchObject({ confidence: 'none', position: { state: 'moving' } })
  expect(assess(model).blindTravelDegrees).toBeCloseTo(30)
  expect(assess(model).budgetArcmin).toBeCloseTo(initial.budgetArcmin + 30 * blindErrorArcminPerDegree)
  expect(assess(model).lastFix).toEqual(initial.lastFix)
  expect(initial.blindTravelDegrees).toBe(0)
})

it('counts a short RA wrap rather than a full turn and ignores old samples', () => {
  const start = run([snapshot({ at: s(0), mount: { at: s(0), raHours: 23.9, decDegrees: 0 } })]).model
  const next = step(start, snapshot({ at: s(1), mount: { at: s(1), raHours: 0.1, decDegrees: 0 } })).model

  expect(assess(next).blindTravelDegrees).toBeCloseTo(3)
  expect(assess(step(next, snapshot({ at: s(0), mount: { at: s(0), raHours: 12, decDegrees: 0 } })).model).blindTravelDegrees).toBeCloseTo(3)
})

it('uses observed axis travel once, without adding the sampled part twice', () => {
  const start = run([snapshot({ at: s(0), mount: { at: s(0), raHours: 2, decDegrees: 40 } })]).model
  const operation = { ...homeOperation({ id: operationId(1), acceptedAt: s(1), startedAt: s(2), settledAt: s(12) }), motion: { ...motion, observed: { ...motion.observed, travel: { rightAscensionDegrees: 30, declinationDegrees: 0 } }, commanded: { ...motion.commanded, sentAt: s(2) }, stopped: { ...motion.stopped, at: s(12) } } }
  const event = snapshot({ at: s(13), mount: { at: s(13), raHours: 3, decDegrees: 40 }, operations: [operation] })
  const next = step(start, event).model

  expect(assess(next).blindTravelDegrees).toBeCloseTo(30)
  expect(assess(step(next, event).model).blindTravelDegrees).toBeCloseTo(30)
})

it('resets to a new fix and leaves history-only solves unable to erase travel', () => {
  const initial = fixed()
  const moved = run(inOrder(tracking(0, 10, home), slew(11, 15, home, away), tracking(15, 25, away))).model
  const before = assess(moved).blindTravelDegrees
  const late = solved(imageIdOf(2), { raDegrees: 0, decDegrees: 0 }, s(26))
  const history = step(step(moved, frame({ image: imageIdOf(2), capturedAt: s(1), exposureSeconds: 2, seenAt: s(3) })).model, late).model

  expect(assess(history).blindTravelDegrees).toBe(before)

  const pair = [
    frame({ image: imageIdOf(3), capturedAt: s(5), exposureSeconds: 2, seenAt: s(7) }),
    solved(imageIdOf(3), { raDegrees: 30, decDegrees: 0 }, s(9)),
  ]

  let reset = { ...initial, blindTravelDegrees: 20 }

  for (const input of pair) reset = step(reset, input).model
  expect(assess(reset).blindTravelDegrees).toBe(0)
  expect(assess(reset).budgetArcmin).toBe(assess(reset).lastFix?.errorArcmin.total)
})

it('applies the budget table at its boundaries and caps uncertain positions', () => {
  const model = fixed()
  const position = model.mount.value

  if (position.state !== 'known') throw new Error('test requires a joined fix')

  for (const [budget, confidence] of [[1.2, 'high'], [1.20001, 'low'], [3, 'low'], [3.00001, 'none']] as const) {
    const fix = { ...position.fix, errorArcmin: { east: budget, north: 0, total: budget } }
    const withBudget = { ...model, mount: { ...model.mount, value: { ...position, fix } } }
    expect(assess(withBudget).confidence).toBe(confidence)
  }

  const fix = { ...position.fix, errorArcmin: { east: 0.1, north: 0, total: 0.1 } }
  const precise = { ...model, mount: { ...model.mount, value: { ...position, fix } } }
  const stale = step(precise, clock(2000)).model

  expect(assess(precise).confidence).toBe('high')
  expect(assess(stale).position.state).toBe('uncertain')
  expect(assess(stale).confidence).toBe('low')
})

it('resets travel at a new session', () => {
  const model = { ...fixed(), blindTravelDegrees: 20 }
  const input = session(s(20))
  expect(assess(step(model, input).model)).toMatchObject({ blindTravelDegrees: 0, budgetArcmin: Infinity })
})

it('does not turn repeated tracking-off snapshots or sidereal drift into blind motion', () => {
  const atRest = { raHours: 2, decDegrees: 0, tracking: false }
  let model = run([snapshot({ at: s(0), mount: { at: s(0), ...atRest } })]).model

  for (let second = 1; second < 20; second++) {
    model = step(model, snapshot({ at: s(second), mount: { at: s(second), ...atRest } })).model
  }

  expect(assess(model).blindTravelDegrees).toBe(0)
  model = step(model, snapshot({ at: s(20), mount: { at: s(20), ...atRest, raHours: 2 + 20_000 * 24 / 86_164_090.5 } })).model
  expect(assess(model).blindTravelDegrees).toBeCloseTo(0)
})

it.each([89, -89, 90, -90])('does not count an RA jump at declination %s as a half-turn of travel', decDegrees => {
  const start = run([snapshot({ at: s(0), mount: { at: s(0), raHours: 0.1, decDegrees } })]).model
  const next = step(start, snapshot({ at: s(1), mount: { at: s(1), raHours: 12.1, decDegrees } })).model

  expect(assess(next).blindTravelDegrees).toBeCloseTo(2 * (90 - Math.abs(decDegrees)))
  expect(assess(next).position.state).toBe('unknown')
})

it('makes an impossible reported jump unbounded until the next current-epoch fix', () => {
  let model = fixed()

  const inputs = inOrder(
    tracking(11, 20, { raHours: 2, decDegrees: 90 }),
    frame({ image: imageIdOf(4), capturedAt: s(12), exposureSeconds: 2, seenAt: s(14) }),
    solved(imageIdOf(4), { raDegrees: 30, decDegrees: 89.9 }, s(15)),
  )

  model = step(model, inputs[0]!).model

  expect(assess(model)).toMatchObject({ blindTravelDegrees: Infinity, budgetArcmin: Infinity, confidence: 'none' })

  for (const input of inputs.slice(1)) model = step(model, input).model
  expect(model.mount.value.state).toBe('known')
  expect(assess(model).blindTravelDegrees).toBe(0)
  expect(assess(model).budgetArcmin).toBe(assess(model).lastFix?.errorArcmin.total)
})

it.each([89, -89, 90, -90])('does not trust an impossible operation axis jump at declination %s', decDegrees => {
  const start = run([snapshot({ at: s(0), mount: { at: s(0), raHours: 0.1, decDegrees } })]).model

  const operation = {
    ...homeOperation({ id: operationId(2), acceptedAt: s(0), startedAt: s(0), settledAt: s(1) }),
    motion: {
      ...motion,
      commanded: { ...motion.commanded, sentAt: s(0) },
      observed: {
        from: { rightAscensionDegrees: 1.5, declinationDegrees: decDegrees },
        to: { rightAscensionDegrees: 181.5, declinationDegrees: decDegrees },
        travel: { rightAscensionDegrees: 180, declinationDegrees: 0 },
      },
      stopped: { ...motion.stopped, at: s(1) },
    },
  }

  const event = snapshot({ at: s(1), mount: { at: s(1), raHours: 12.1, decDegrees }, operations: [operation] })
  const model = step(start, event).model

  expect(assess(model)).toMatchObject({ blindTravelDegrees: Infinity, budgetArcmin: Infinity, confidence: 'none' })
  expect(assess(step(model, event).model).blindTravelDegrees).toBe(Infinity)
})
