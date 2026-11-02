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

  for (const [second, raHours] of [[11, 3], [12, 2]] as const) {
    model = step(model, snapshot({ at: s(second), mount: { at: s(second), raHours, decDegrees: 0, slewing: true } })).model
  }

  expect(assess(model)).toMatchObject({ confidence: 'none', blindTravelDegrees: 30, position: { state: 'moving' } })
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
  const operation = { ...homeOperation({ id: operationId(1), acceptedAt: s(1), startedAt: s(2), settledAt: s(4) }), motion: { ...motion, observed: { ...motion.observed, travel: { rightAscensionDegrees: 30, declinationDegrees: 0 } }, commanded: { ...motion.commanded, sentAt: s(2) }, stopped: { ...motion.stopped, at: s(4) } } }
  const event = snapshot({ at: s(5), mount: { at: s(5), raHours: 3, decDegrees: 40 }, operations: [operation] })
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

  const stale = step(model, clock(2000)).model
  expect(assess(stale).position.state).toBe('uncertain')
  expect(assess(stale)).toEqual(assess(stale))
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
