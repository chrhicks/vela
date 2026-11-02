import { expect, it } from 'vitest'
import { encodeEvent, subjectOf } from '@vela/rig-events'
import { sampleEvents } from './samples.ts'

it('keeps the shadow verdict on its own solver-owned fact subject', () => {
  const event = sampleEvents().find(event => event.kind === 'solve-result')!

  expect(subjectOf(event.rig, event.kind)).toBe('rig.v1.test-rig.fact.solve-result')
  expect(encodeEvent(event)).toMatchSnapshot()
})
