import { expect, it } from 'vitest'
import { motion, motionState } from '../../rig-events/test/motion-sample.ts'
import { observeMount } from '../src/observation.ts'

it('exposes the settled operation record from the snapshot', () => {
  expect(observeMount(motionState())?.operations[0]).toMatchObject({ phase: 'settled', confirmed: true, motion })
})

it('observes an old settled operation without a record', () => {
  expect(observeMount(motionState(false))?.operations[0]).toEqual({ id: '00000000-0000-4000-8000-000000000001', phase: 'settled', startedAt: 95, settledAt: 210, confirmed: true })
})
