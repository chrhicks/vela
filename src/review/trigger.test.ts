import { describe, expect, it } from 'vitest'
import { newTrigger, observe, type Sample, type Trigger, type TriggerLimits } from './trigger.ts'

const limits: TriggerLimits = { baselineFrames: 3, hfdRise: 0.2, starsDrop: 0.25, elongation: 1.3, guideLostBurst: 3, cooldownFrames: 4, worseAgain: 0.15 }

const frame = (n: number, over: Partial<Sample> = {}): Sample => ({ file: `frame_${n}.fits`, hfdPixels: 2.4, stars: 2900, elongation: 1.1, guideLost: 0, ...over })

function run(samples: ReadonlyArray<Sample>, from: Trigger = newTrigger) {
  return samples.reduce<{ state: Trigger; asked: ReadonlyArray<{ file: string; reasons: ReadonlyArray<string>; good: string }> }>(
    ({ state, asked }, sample) => {
      const next = observe(limits, state, sample)

      return { state: next.state, asked: next.ask === undefined ? asked : [...asked, { file: sample.file, reasons: next.ask.reasons, good: next.ask.good.file }] }
    },
    { state: from, asked: [] },
  )
}

const steady = [frame(1), frame(2), frame(3)]

describe('when a frame is asked about', () => {
  it('asks about nothing while the baseline is being made, even from poor frames', () => {
    expect(run([frame(1, { hfdPixels: 9 }), frame(2), frame(3, { stars: 50 })]).asked).toEqual([])
  })

  it('takes the baseline from the first good frames: the median of their HFD and stars', () => {
    const { state } = run([frame(1, { hfdPixels: 2.3, stars: 2800 }), frame(2, { hfdPixels: 2.5, stars: 3000 }), frame(3, { hfdPixels: 2.4, stars: 2900 })])

    expect(state.baseline).toEqual({ hfdPixels: 2.4, stars: 2900 })
  })

  it('leaves frames with no stars or too elongated out of the baseline', () => {
    const { state } = run([frame(1, { stars: null, hfdPixels: null }), frame(2, { elongation: 1.6 }), frame(3), frame(4), frame(5)])

    expect(state.baseline).toEqual({ hfdPixels: 2.4, stars: 2900 })
    expect(state.early.map(sample => sample.file)).toEqual(['frame_3.fits', 'frame_4.fits', 'frame_5.fits'])
  })

  it('does not ask about frames within the limits', () => {
    expect(run([...steady, frame(4, { hfdPixels: 2.8, stars: 2300, elongation: 1.3 })]).asked).toEqual([])
  })

  it('asks when the HFD is up by the fraction, naming the last good frame', () => {
    expect(run([...steady, frame(4), frame(5, { hfdPixels: 2.9 })]).asked).toEqual([{ file: 'frame_5.fits', reasons: ['hfd'], good: 'frame_4.fits' }])
  })

  it('asks when the star count is down by the fraction', () => {
    expect(run([...steady, frame(4, { stars: 2175 })]).asked).toEqual([{ file: 'frame_4.fits', reasons: ['stars'], good: 'frame_3.fits' }])
  })

  it('asks when the stars are too elongated', () => {
    expect(run([...steady, frame(4, { elongation: 1.31 })]).asked[0]?.reasons).toEqual(['elongation'])
  })

  it('asks on a burst of guide star losses, and not on fewer', () => {
    expect(run([...steady, frame(4, { guideLost: 2 })]).asked).toEqual([])
    expect(run([...steady, frame(4, { guideLost: 3 })]).asked[0]?.reasons).toEqual(['guide-lost'])
  })

  it('names every limit a frame crosses', () => {
    expect(run([...steady, frame(4, { hfdPixels: 3.3, stars: 1900, guideLost: 5 })]).asked[0]?.reasons).toEqual(['hfd', 'stars', 'guide-lost'])
  })

  it('judges a frame with no star count by what it does have', () => {
    expect(run([...steady, frame(4, { stars: null, hfdPixels: null, elongation: null })]).asked).toEqual([])
    expect(run([...steady, frame(4, { stars: 0, hfdPixels: null })]).asked[0]?.reasons).toEqual(['stars'])
  })

  it('keeps the last frame that crossed nothing as the last good one', () => {
    const { asked } = run([...steady, frame(4, { hfdPixels: 2.5 }), frame(5, { hfdPixels: 3.1 }), frame(6, { hfdPixels: 3.2 })])

    expect(asked).toEqual([{ file: 'frame_5.fits', reasons: ['hfd'], good: 'frame_4.fits' }])
  })

  it('waits the cooldown after an ask, then asks again if the frame is still poor', () => {
    const bad = (n: number) => frame(n, { hfdPixels: 3 })
    const { asked } = run([...steady, bad(4), bad(5), bad(6), bad(7), bad(8)])

    expect(asked.map(each => each.file)).toEqual(['frame_4.fits', 'frame_8.fits'])
  })

  it('asks inside the cooldown when the HFD rises again by the fraction', () => {
    const { asked } = run([...steady, frame(4, { hfdPixels: 3 }), frame(5, { hfdPixels: 3.2 }), frame(6, { hfdPixels: 3.5 })])

    expect(asked.map(each => [each.file, each.reasons])).toEqual([
      ['frame_4.fits', ['hfd']],
      ['frame_6.fits', ['hfd', 'worse-again']],
    ])
  })

  it('asks inside the cooldown when the star count falls again by the fraction', () => {
    const { asked } = run([...steady, frame(4, { stars: 2100 }), frame(5, { stars: 1900 }), frame(6, { stars: 1700 })])

    expect(asked.map(each => each.file)).toEqual(['frame_4.fits', 'frame_6.fits'])
  })

  it('counts the cooldown from the latest ask', () => {
    const bad = (n: number) => frame(n, { hfdPixels: 3 })
    const { asked } = run([...steady, bad(4), bad(5), bad(6), bad(7), bad(8), bad(9), bad(10), bad(11), bad(12)])

    expect(asked.map(each => each.file)).toEqual(['frame_4.fits', 'frame_8.fits', 'frame_12.fits'])
  })
})
