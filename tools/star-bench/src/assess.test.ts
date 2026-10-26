import { describe, expect, it } from 'vitest'
import { shippedReplay } from './alerts.ts'
import { assessNight, passedFor } from './assess.ts'
import type { NightLabels } from './labels.ts'
import { frameTime, haze, syntheticRun } from './test-runs.ts'

const at = (index: number) => frameTime(index)

function labels(windows: NightLabels['windows'], overrides: Partial<NightLabels> = {}): NightLabels {
  return { night: 'Fixture night', target: 'Fixture Nebula', exposureSeconds: 90, use: 'calibration', file: 'fixture.json', windows, ...overrides }
}

const counts = haze(50, 100, 20, 12, 20)

const run = syntheticRun(counts)

const healthyBefore: NightLabels['windows'][number] = { kind: 'healthy', from: at(0), to: at(19), note: 'quiet' }

const hazeEvent: NightLabels['windows'][number] = { kind: 'event', name: 'haze', from: at(20), to: at(35), expect: ['stars-dropping'], note: 'haze' }

const healthyAfter: NightLabels['windows'][number] = { kind: 'healthy', from: at(40), to: at(49), note: 'quiet again' }

describe('assessNight', () => {
  it('passes a night whose event raised what it expects and whose healthy windows stayed quiet', () => {
    const night = assessNight(labels([healthyBefore, hazeEvent, healthyAfter]), [run], shippedReplay)

    expect(night.passed).toBe(true)
    const [, event] = night.windows

    expect(event!.required).toEqual([{ id: 'stars-dropping', episode: expect.objectContaining({ id: 'stars-dropping' }) }])
    expect(event!.required[0]!.episode!.from).toBeGreaterThanOrEqual(at(20))
  })

  it('fails when an expected alert never starts in its window', () => {
    const calm = syntheticRun(Array(50).fill(100))
    const night = assessNight(labels([healthyBefore, hazeEvent, healthyAfter]), [calm], shippedReplay)

    expect(night.passed).toBe(false)
    expect(night.windows[1]!.required).toEqual([{ id: 'stars-dropping', episode: null }])
  })

  it('fails when an alert starts inside a window that said the night was healthy', () => {
    const night = assessNight(labels([{ kind: 'healthy', from: at(0), to: at(49), note: 'all fine' }]), [run], shippedReplay)

    expect(night.passed).toBe(false)
    expect(night.windows[0]!.unexpected.map(episode => episode.id)).toEqual(['stars-dropping'])
  })

  it('fails on an alert that starts where no window says anything, so labels must cover the night', () => {
    const night = assessNight(labels([healthyBefore, healthyAfter]), [run], shippedReplay)

    expect(night.passed).toBe(false)
    expect(night.unlabelled.map(episode => episode.id)).toEqual(['stars-dropping'])
  })

  it('fails on an alert an event window neither expects nor allows', () => {
    const night = assessNight(labels([healthyBefore, { ...hazeEvent, expect: ['hfr-high'] }, healthyAfter]), [run], shippedReplay)

    expect(night.passed).toBe(false)
    expect(night.windows[1]!.unexpected.map(episode => episode.id)).toEqual(['stars-dropping'])
  })

  it('lets a transition window allow the alerts it names and no others', () => {
    const transition = { kind: 'transition' as const, from: at(20), to: at(35), allow: ['stars-dropping' as const], note: 'moving' }

    expect(assessNight(labels([healthyBefore, transition, healthyAfter]), [run], shippedReplay).passed).toBe(true)
    expect(assessNight(labels([healthyBefore, { ...transition, allow: [] }, healthyAfter]), [run], shippedReplay).passed).toBe(false)
  })

  it('does not pass a night whose run is missing, whatever the labels say', () => {
    const night = assessNight(labels([healthyBefore]), [], shippedReplay)

    expect(night.runs).toEqual([])
    expect(night.passed).toBe(false)
  })

  it('finds the run by target and exposure, not by being the only one', () => {
    const other = { ...syntheticRun(counts), target: 'Other Nebula' }
    const short = { ...syntheticRun(counts), exposureSeconds: 30 }

    expect(assessNight(labels([healthyBefore, hazeEvent, healthyAfter]), [other, short, run], shippedReplay).runs).toEqual([run])
    expect(assessNight(labels([healthyBefore, hazeEvent, healthyAfter]), [other, short], shippedReplay).runs).toEqual([])
  })
})

describe('a night split by a reset', () => {
  const first = syntheticRun(Array(10).fill(100))

  const second = {
    ...syntheticRun(haze(30, 100, 10, 12, 20)),
    frames: haze(30, 100, 10, 12, 20).map((stars, index) => ({ capturedAt: at(10 + index), stars, hfrPixels: 2 })),
  }

  it('assesses every run of the night with its own history, not only the first', () => {
    const windows: NightLabels['windows'] = [{ kind: 'healthy', from: at(0), to: at(39), note: 'all fine' }]
    const night = assessNight(labels(windows), [first, second], shippedReplay)

    expect(night.runs).toHaveLength(2)
    expect(night.passed).toBe(false)
    expect(night.windows[0]!.unexpected.map(episode => episode.id)).toEqual(['stars-dropping'])
  })
})

describe('a window with no frames', () => {
  it('fails, because a night with nothing in the window proved nothing', () => {
    const empty: NightLabels['windows'][number] = { kind: 'healthy', from: at(100), to: at(110), note: 'after the run' }
    const night = assessNight(labels([healthyBefore, empty]), [syntheticRun(Array(50).fill(100))], shippedReplay)

    expect(night.windows[1]!.frames).toBe(0)
    expect(night.passed).toBe(false)
  })
})

describe('passedFor', () => {
  it('judges one alert, so another alert missing on the night does not hide it', () => {
    const night = assessNight(labels([healthyBefore, { ...hazeEvent, expect: ['stars-dropping', 'stars-collapsed'] }, healthyAfter]), [run], shippedReplay)

    expect(night.passed).toBe(false)
    expect(passedFor(night, 'stars-dropping')).toBe(true)
    expect(passedFor(night, 'stars-collapsed')).toBe(false)
  })
})
