import { describe, expect, it } from 'vitest'
import type { FrameResult } from './compare.ts'
import type { SavedFrame } from './frames.ts'
import { groupRuns } from './runs.ts'

const start = Date.parse('2030-01-01T02:00:00Z')

function result(
  minutes: number,
  stars: number,
  overrides: Partial<Pick<SavedFrame, 'frameType' | 'target' | 'exposureSeconds'>> = {},
): FrameResult {
  return {
    frame: {
      id: `frame-${minutes}`,
      directory: `/saved/frame-${minutes}`,
      capturedAt: start + minutes * 60_000,
      frameType: 'light',
      target: 'Fixture Nebula',
      exposureSeconds: 90,
      recorded: null,
      ...overrides,
    },
    measurement: { status: 'measured', detectedStars: stars, medianHfrPixels: 2, milliseconds: 1 },
    comparison: { status: 'unrecorded' },
  }
}

describe('groupRuns', () => {
  it('keeps neighbouring light frames of one target and exposure in one run, oldest first', () => {
    const runs = groupRuns([result(3, 31), result(0, 30), result(6, 32)], 30)

    expect(runs).toHaveLength(1)
    expect(runs[0]!.frames.map(frame => frame.stars)).toEqual([30, 31, 32])
  })

  it('starts a new run after a gap longer than the limit, not at the limit', () => {
    expect(groupRuns([result(0, 30), result(30, 30)], 30)).toHaveLength(1)
    expect(groupRuns([result(0, 30), result(31, 30)], 30)).toHaveLength(2)
  })

  it('starts a new run where a restart time falls between two frames', () => {
    const frames = [result(0, 30), result(3, 30), result(6, 30)]

    expect(groupRuns(frames, 30, [start + 4 * 60_000]).map(run => run.frames.length)).toEqual([2, 1])
    expect(groupRuns(frames, 30, [start + 3 * 60_000]).map(run => run.frames.length)).toEqual([1, 2])
    expect(groupRuns(frames, 30, [start + 7 * 60_000]).map(run => run.frames.length)).toEqual([3])
  })

  it('separates targets and exposures even when their frames interleave', () => {
    const runs = groupRuns(
      [
        result(0, 30),
        result(1, 50, { target: 'Other Nebula' }),
        result(2, 30),
        result(3, 40, { exposureSeconds: 60 }),
      ],
      30,
    )

    expect(runs.map(run => [run.target, run.exposureSeconds, run.frames.length])).toEqual([
      ['Fixture Nebula', 90, 2],
      ['Other Nebula', 90, 1],
      ['Fixture Nebula', 60, 1],
    ])
  })

  it('leaves out calibration frames and frames that were not measured', () => {
    const failed: FrameResult = {
      ...result(2, 0),
      measurement: { status: 'failed', reason: 'bad header' },
      comparison: { status: 'failed', reason: 'bad header' },
    }

    const runs = groupRuns([result(0, 30), result(1, 0, { frameType: 'dark', target: null }), failed], 30)

    expect(runs.map(run => run.frames.length)).toEqual([1])
  })

  it('names a light frame with no target', () => {
    expect(groupRuns([result(0, 30, { target: null })], 30)[0]!.target).toBe('(no target)')
  })
})
