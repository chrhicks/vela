import { describe, expect, it } from 'vitest'
import { epochMs } from '@vela/rig-events'
import { appendSample, cover, emptyTrack, lookup, type MountSample, type MountTrack } from '@vela/rig-model'

const at = (offset: number) => epochMs(1_000_000 + offset)

function sample(offset: number, overrides: Partial<MountSample> = {}): MountSample {
  return { at: at(offset), raHours: 5, decDegrees: 10, frame: 'topocentric', slewing: false, tracking: true, pierSide: 'east', fresh: true, ...overrides }
}

function trackOf(samples: readonly MountSample[], coveredUntil: number | null): MountTrack {
  const built = samples.reduce((track, item) => appendSample(track, item, epochMs(0)), emptyTrack)

  return coveredUntil === null ? built : cover(built, at(coveredUntil))
}

describe('the mount track', () => {
  it('holds a sample until the next one arrives', () => {
    const track = trackOf([sample(0), sample(50_000, { raHours: 6 })], 100_000)
    const early = lookup(track, at(10_000), at(40_000))
    const late = lookup(track, at(60_000), at(90_000))

    expect(early.kind === 'held' && early.sample.raHours).toBe(5)
    expect(late.kind === 'held' && late.sample.raHours).toBe(6)
  })

  it('lists the samples that arrive during an exposure', () => {
    const track = trackOf([sample(0), sample(20_000, { raHours: 5.001 })], 100_000)
    const found = lookup(track, at(10_000), at(40_000))

    expect(found.kind === 'held' && found.changes.map(change => change.raHours)).toEqual([5.001])
  })

  it('waits for coverage: a calm mount and a silent stream look alike without it', () => {
    const track = trackOf([sample(0)], 30_000)

    expect(lookup(track, at(10_000), at(40_000))).toEqual({ kind: 'not-yet-covered' })
    expect(lookup(emptyTrack, at(10_000), at(40_000))).toEqual({ kind: 'not-yet-covered' })
    expect(lookup(track, at(10_000), at(30_000)).kind).toBe('held')
  })

  it('has no answer before its first sample, and refuses a stale one', () => {
    expect(lookup(trackOf([sample(50_000)], 100_000), at(10_000), at(40_000))).toEqual({ kind: 'no-sample' })
    expect(lookup(trackOf([sample(0, { fresh: false })], 100_000), at(10_000), at(40_000))).toEqual({ kind: 'stale' })
  })

  it('refuses a reading that turns stale while the exposure runs', () => {
    const track = trackOf([sample(0), sample(5_000, { fresh: false })], 100_000)

    expect(lookup(track, at(2_000), at(8_000))).toEqual({ kind: 'stale' })
    expect(lookup(track, at(0), at(4_000)).kind).toBe('held')
  })

  it('does not store a sample that repeats the last one', () => {
    expect(trackOf([sample(0), sample(1000), sample(2000)], 5000).samples).toHaveLength(1)
  })

  it('ignores a sample older than the last, and replaces one at the same instant', () => {
    expect(trackOf([sample(1000), sample(500, { raHours: 9 })], 5000).samples.map(item => item.raHours)).toEqual([5])
    expect(trackOf([sample(1000), sample(1000, { raHours: 9 })], 5000).samples.map(item => item.raHours)).toEqual([9])
  })

  it('forgets old samples but keeps the one that still holds', () => {
    const track = [sample(0), sample(10_000, { raHours: 6 }), sample(20_000, { raHours: 7 })].reduce((built, item) => appendSample(built, item, at(15_000)), emptyTrack)

    expect(track.samples.map(item => item.raHours)).toEqual([6, 7])
  })

  it('finds the holding sample among many by binary search', () => {
    const many = Array.from({ length: 2000 }, (_, index) => sample(index * 10, { raHours: 1 + index / 1000 }))
    const track = trackOf(many, 30_000)
    const found = lookup(track, at(12_345), at(12_400))

    expect(found.kind === 'held' && found.sample.raHours).toBeCloseTo(1 + 1234 / 1000, 9)
  })
})
