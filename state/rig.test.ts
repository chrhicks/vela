import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { emptyRig, rig } from './rig.ts'
import { fold, frameKept, frameMeasured, read, runStarted } from './testing.ts'

describe('rig', () => {
  it('records how far along the stream the state is', () => {
    const last = frameKept('m31_001.fits', 2000)
    const state = fold(rig, emptyRig, [runStarted('r1', 1000), last])

    expect(state.position).toBe(last.seq)
    expect(state.run?.id).toBe('r1')
    expect(state.frames).toHaveLength(1)
  })

  it('keeps every slice an entry does not concern identical', () => {
    const before = fold(rig, emptyRig, [runStarted('r1', 1000), frameKept('m31_001.fits', 2000)])
    const after = rig(before, Option.getOrThrow(read(frameMeasured('m31_099.fits', 2001, {}))))

    expect(after.run).toBe(before.run)
    expect(after.frames).toBe(before.frames)
  })
})
