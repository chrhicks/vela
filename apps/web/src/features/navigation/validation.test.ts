import { describe, expect, it } from 'vitest'
import { isNavigationView } from './validation'

const activity = { rigId: 'a', rigName: 'Askar', active: true, phase: 'exposing', completedCount: 17, elapsedSeconds: 18, exposureSeconds: 60, error: null }
const view = { rigs: [{ id: 'a', name: 'Askar' }], captures: [activity] }
describe('navigation boundary', () => {
  it('accepts current and terminal snapshots but rejects contradictory progress and identity', () => {
    expect(isNavigationView(view)).toBe(true)
    expect(isNavigationView({ ...view, captures: [{ ...activity, phase: 'stopped', active: false }] })).toBe(true)
    for (const patch of [{ rigId: 'other' }, { rigName: 'Another rig' }, { active: false }, { completedCount: -1 }, { completedCount: 1.5 }, { elapsedSeconds: Infinity }, { exposureSeconds: 0 }]) {
      expect(isNavigationView({ ...view, captures: [{ ...activity, ...patch }] })).toBe(false)
    }
    expect(isNavigationView({ ...view, rigs: [...view.rigs, ...view.rigs] })).toBe(false)
    expect(isNavigationView({ ...view, captures: [activity, activity] })).toBe(false)
  })
})
