import { describe, expect, it } from 'vitest'
import type { FirstFramesBody } from '../../state/entries.ts'
import { entry, foldRig, frameKept, frameMeasured } from '../../state/testing.ts'
import { makeFirstFramesCheck } from './first-frames.ts'

const limits = { skippedFrames: 2, checkedFrames: 3, focusRatio: 1.3, trailedElongation: 1.5 }

const started = entry('vela.run.started', 1000, { run: 'r1', object: 'NGC 7635', frameType: 'light', exposureSeconds: 60, count: 300, gain: 100, offset: 50, sequence: 'NGC-7635_light' })

const kept = (number: number) => {
  const file = `NGC-7635_light_00${number}.fits`

  return [entry('vela.frame', 1000 + number * 60_000, { night: '2026-11-10', file, sequence: 'NGC-7635_light' }), frameMeasured(file, 1000 + number * 60_000 + 500, { stars: 550, hfdPixels: 3.1, elongation: 1.06, sky: 508, noise: 7.4 }, '2026-11-10')]
}

function watching() {
  const announced: Array<FirstFramesBody> = []

  return { announced, check: makeFirstFramesCheck({ limits, announce: checked => void announced.push(checked) }) }
}

describe('announcing the first frames of a run', () => {
  it('says nothing until the checked frames are measured, then announces the verdict once', () => {
    const { announced, check } = watching()
    const entries = [started, ...[1, 2, 3, 4].flatMap(kept)]

    check.observe(foldRig(entries))
    expect(announced).toEqual([])

    const complete = foldRig([...entries, ...kept(5)])

    check.observe(complete)
    check.observe(foldRig([...entries, ...kept(5), ...kept(6)]))

    expect(announced).toHaveLength(1)
    expect(announced[0]).toMatchObject({ run: 'r1', verdict: 'passed', frames: { from: 3, to: 5 } })
    expect(announced[0]?.checks.map(found => found.check)).toEqual(['stars', 'focus', 'trailing', 'sky', 'filter', 'settings', 'guiding'])
  })

  it('does not announce again for a run whose verdict is already on the stream', () => {
    const { announced, check } = watching()
    const already = entry('vela.first-frames', 400_000, { run: 'r1', verdict: 'passed', frames: { from: 3, to: 5 }, checks: [] })

    check.observe(foldRig([started, ...[1, 2, 3, 4, 5].flatMap(kept), already]))

    expect(announced).toEqual([])
  })
})
