import { describe, expect, it } from 'vitest'
import { emptyRig, rig } from './rig.ts'
import { entry, frameKept, runStarted } from './testing.ts'

describe('rig', () => {
  it('records how far along the stream the state is', () => {
    const last = frameKept('m31_001.fits', 2000)
    const state = [runStarted('r1', 1000), last].reduce(rig, emptyRig)

    expect(state.position).toBe(last.seq)
    expect(state.run?.id).toBe('r1')
    expect(state.frames).toHaveLength(1)
  })

  it('keeps every slice an entry does not concern identical', () => {
    const before = [runStarted('r1', 1000), frameKept('m31_001.fits', 2000)].reduce(rig, emptyRig)
    const after = rig(before, entry('phd2.GuideStep', 2001, {}))

    expect(after.run).toBe(before.run)
    expect(after.frames).toBe(before.frames)
  })
})
