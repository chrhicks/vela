import { Option, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { advance, emptyRig, rig } from './rig.ts'
import { entry, foldRig, frameKept, frameMeasured, read, runStarted } from './testing.ts'

describe('rig', () => {
  it('records how far along the stream the state is', () => {
    const last = frameKept('m31_001.fits', 2000)
    const state = foldRig([runStarted('r1', 1000), last])

    expect(state.position).toBe(last.seq)
    expect(state.run?.id).toBe('r1')
    expect(state.frames).toHaveLength(1)
  })

  it('keeps every slice an entry does not concern identical', () => {
    const before = foldRig([runStarted('r1', 1000), frameKept('m31_001.fits', 2000)])
    const after = Result.getOrThrow(rig(before, Option.getOrThrow(read(frameMeasured('m31_099.fits', 2001, {})))))

    expect(after.run).toBe(before.run)
    expect(after.frames).toBe(before.frames)
  })
})

describe('advance', () => {
  it('folds an entry a reducer reads, and moves the position past one none reads', () => {
    const started = runStarted('r1', 1000)
    const guided = entry('phd2.Version', 1001, { Event: 'Version' })
    const state = [started, guided].reduce((current, next) => Result.getOrThrow(advance(current, next)), emptyRig)

    expect(state.run?.id).toBe('r1')
    expect(state.position).toBe(guided.seq)
  })

  it('fails with the entry when a known kind has the wrong shape', () => {
    expect(Result.isFailure(advance(emptyRig, entry('vela.frame', 1, { night: 'tonight' })))).toBe(true)
  })

  it('remembers when the rig program was last heard from, and not Vela itself', () => {
    const heard = entry('wire', 5000, { dir: 'in', device: 'mount', type: 'set', property: 'EQUATORIAL_EOD_COORD', state: 'Ok', elements: { RA: 1, DEC: 2 } })
    const state = foldRig([heard, frameKept('m31_001.fits', 9000)])

    expect(state.heardAt).toBe(5000)
  })
})
