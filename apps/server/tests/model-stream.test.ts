import { expect, it } from 'vitest'
import { seal } from '@vela/rig-events'
import { assess } from '@vela/rig-model'
import { inOrder, run } from '../../../packages/rig-model/test/support.js'
import { createStreamModel } from '../src/rig-model/stream.js'
import { modelFixture } from './fixtures/model-stream.js'

it('accepted solve-result shares legacy joins and epochs; rejected verdict cannot establish a fix', () => {
  const { solution, shadow, baseline } = modelFixture()

  if (shadow.kind !== 'solve-result') throw new Error('Expected solve-result')
  const { id: _id, v: _v, ...draft } = shadow

  const rejected = seal({ ...draft, body: { ...shadow.body, verdict: { status: 'rejected', reasons: ['scale'], measured: null } } })
  const legacy = run(inOrder(baseline, solution)).model
  const streamed = run(inOrder(baseline, shadow)).model
  const refused = run(inOrder(baseline, rejected)).model

  expect(assess(legacy).position.state).toBe('known')
  expect(assess(streamed)).toEqual(assess(legacy))
  expect(assess(refused).position.state).toBe('unknown')
  console.log(JSON.stringify({ legacySolve: assess(legacy).position.state, shadowSolveResult: assess(streamed).position.state, rejectedShadowSolveResult: assess(refused).position.state }))
})

it('duplicate stream delivery leaves both assessments and emitted envelopes unchanged', () => {
  const { baseline, shadow } = modelFixture()
  const events = inOrder(baseline, shadow)
  const live = createStreamModel()
  const duplicate = createStreamModel()

  expect(events.flatMap(event => duplicate.accept(event).concat(duplicate.accept(event))))
    .toEqual(events.flatMap(event => live.accept(event)))
  expect(duplicate.get(shadow.rig)).toEqual(live.get(shadow.rig))
})
