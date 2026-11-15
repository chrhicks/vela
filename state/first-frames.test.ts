import { describe, expect, it } from 'vitest'
import { NightName, FrameFile, RunId } from './entries.ts'
import type { FirstFramesLimits } from './first-frames-check.ts'
import { firstFrames, type Seen } from './first-frames.ts'
import type { Frame } from './frames.ts'
import type { Run } from './run.ts'

const limits: FirstFramesLimits = { skippedFrames: 2, checkedFrames: 3, focusRatio: 1.3, trailedElongation: 1.5 }

const run: Run = { status: 'capturing', id: RunId.make('r1'), object: 'NGC 7635', frameType: 'light', exposureSeconds: 60, count: 300, sequence: 'NGC-7635_light', gain: 100, offset: 50, startedAt: 1000, frames: 0, failures: 0 }

const frame = (number: number, measured?: { readonly hfdPixels: number; readonly elongation: number; readonly stars?: number | null }): Frame => ({
  night: NightName.make('2026-11-10'),
  file: FrameFile.make(`NGC-7635_light_${String(number).padStart(3, '0')}.fits`),
  sequence: 'NGC-7635_light',
  keptAt: 1000 + number * 60_000,
  measurements: measured === undefined ? undefined : { stars: measured.stars === undefined ? 550 : measured.stars, hfdPixels: measured.hfdPixels, elongation: measured.elongation, sky: 508, noise: 7.4 },
})

const seen = (frames: ReadonlyArray<Frame>, more: Partial<Seen> = {}): Seen => ({ run, frames, focusedPixels: 2.9, filter: 'in', camera: { Gain: 100, Offset: 50 }, guiding: { activity: 'guiding', averagePixels: 0.4 }, ...more })

const round = [frame(1, { hfdPixels: 3.09, elongation: 1.47 }), frame(2, { hfdPixels: 3.16, elongation: 1.06 }), frame(3, { hfdPixels: 3.18, elongation: 1.06 }), frame(4, { hfdPixels: 3.08, elongation: 1.06 }), frame(5, { hfdPixels: 3.26, elongation: 1.06 })]

const verdicts = (found: ReturnType<typeof firstFrames>) => Object.fromEntries((found?.checks ?? []).map(check => [check.check, check.verdict]))

describe('the first frames of a run', () => {
  it('waits out the frames taken while the mount and the guider settle', () => {
    expect(firstFrames(seen(round.slice(0, 2)), limits)).toMatchObject({ stage: 'settling', frames: 2, checked: { from: 3, to: 5 } })
  })

  it('is still checking until every checked frame has been measured', () => {
    expect(firstFrames(seen([...round.slice(0, 4), frame(5)]), limits)).toMatchObject({ stage: 'checking', frames: 5 })
  })

  it('passes round stars near the focus that autofocus reached, and does not count the stretched first frame', () => {
    const found = firstFrames(seen(round), limits)

    expect(found).toMatchObject({ stage: 'passed' })
    expect(found?.checks).toEqual([
      { check: 'stars', verdict: 'ok', stars: 550 },
      { check: 'focus', verdict: 'ok', hfdPixels: 3.18, focusedPixels: 2.9 },
      { check: 'trailing', verdict: 'ok', elongation: 1.06 },
      { check: 'sky', verdict: 'not-judged', sky: 508 },
      { check: 'filter', verdict: 'not-judged', filter: 'in' },
      { check: 'settings', verdict: 'ok', asSet: true },
      { check: 'guiding', verdict: 'ok', activity: 'guiding', averagePixels: 0.4 },
    ])
  })

  it('is poor when the checked frames are trailed, as on a lost guide star', () => {
    const trailed = [frame(1, { hfdPixels: 4.17, elongation: 1.15 }), frame(2, { hfdPixels: 3.69, elongation: 1.9 }), frame(3, { hfdPixels: 3.75, elongation: 2.19 }), frame(4, { hfdPixels: 3.68, elongation: 2.18 }), frame(5, { hfdPixels: 3.76, elongation: 1.94 })]
    const found = firstFrames(seen(trailed, { guiding: { activity: 'starLost' } }), limits)

    expect(found?.stage).toBe('poor')
    expect(verdicts(found)).toMatchObject({ trailing: 'poor', guiding: 'poor', focus: 'ok' })
  })

  it('is poor when the stars are much larger than autofocus reached, when no stars are found, and when the camera is not as set', () => {
    const soft = round.map((kept, index) => frame(index + 1, { hfdPixels: 4.2, elongation: 1.05 }))
    const empty = round.map((kept, index) => frame(index + 1, { hfdPixels: 3.1, elongation: 1.05, stars: 0 }))

    expect(verdicts(firstFrames(seen(soft), limits))).toMatchObject({ focus: 'poor' })
    expect(verdicts(firstFrames(seen(empty), limits))).toMatchObject({ stars: 'poor' })
    expect(verdicts(firstFrames(seen(round, { camera: { Gain: 120, Offset: 50 } }), limits))).toMatchObject({ settings: 'poor' })
  })

  it('does not judge what it has nothing to judge against, and still passes', () => {
    const found = firstFrames(seen(round, { focusedPixels: undefined, filter: undefined, camera: undefined, guiding: {} }), limits)

    expect(found?.stage).toBe('passed')
    expect(verdicts(found)).toMatchObject({ focus: 'not-judged', settings: 'not-judged', guiding: 'not-judged' })
  })

  it('takes only the frames of this run, not earlier ones of the same name', () => {
    const earlier = { ...frame(9, { hfdPixels: 9, elongation: 3 }), keptAt: 500 }

    expect(firstFrames(seen([earlier, ...round]), limits)).toMatchObject({ stage: 'passed', frames: 5 })
  })

  it('is not made for calibration frames or with no run', () => {
    expect(firstFrames(seen(round, { run: { ...run, frameType: 'dark' } }), limits)).toBeUndefined()
    expect(firstFrames(seen(round, { run: undefined }), limits)).toBeUndefined()
  })
})
