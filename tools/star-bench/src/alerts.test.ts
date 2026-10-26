import { describe, expect, it } from 'vitest'
import { replayAlerts, shippedReplay } from './alerts.ts'
import { frameTime, syntheticRun } from './test-runs.ts'

describe('replayAlerts', () => {
  it('raises nothing on a night whose count wobbles but holds', () => {
    const wobble = Array.from({ length: 40 }, (_, index) => 100 + ((index * 7) % 21) - 10)

    expect(replayAlerts(syntheticRun(wobble))).toEqual([])
  })

  it('raises stars-dropping while a haze holds the count down, and clears it once the stars return', () => {
    const counts = [...Array(15).fill(100), ...Array(10).fill(25), ...Array(15).fill(100)]
    const episodes = replayAlerts(syntheticRun(counts))

    expect(episodes.map(episode => episode.id)).toEqual(['stars-dropping'])
    const [dropping] = episodes

    expect(dropping!.from).toBeGreaterThanOrEqual(frameTime(15))
    expect(dropping!.from).toBeLessThanOrEqual(frameTime(24))
    expect(dropping!.until).toBeGreaterThan(frameTime(24))
  })

  it('reports an alert still standing at the last frame as having no end', () => {
    const episodes = replayAlerts(syntheticRun([...Array(15).fill(100), ...Array(10).fill(25)]))

    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({ id: 'stars-dropping', until: null })
  })

  it('raises no-stars when a run never finds a star', () => {
    const episodes = replayAlerts(syntheticRun(Array(8).fill(0), 0))

    expect(episodes.map(episode => episode.id)).toContain('no-stars')
  })

  it('raises hfr-high when the stars go soft', () => {
    const episodes = replayAlerts(syntheticRun(Array(12).fill(100), 4.5))

    expect(episodes.map(episode => episode.id)).toContain('hfr-high')
  })
})

describe('replayAlerts options', () => {
  const counts = [...Array(15).fill(100), ...Array(10).fill(25), ...Array(15).fill(100)]

  it('says what the alert said on the frame that raised it, cause included', () => {
    const [dropping] = replayAlerts(syntheticRun(counts))

    expect(dropping!.message).toMatch(/^Star count dropping: median \d+ \(normal ≈\d+ stars\)/)
  })

  it('reads the count it is told to, so a measured count and a strong count can be compared', () => {
    const steady = syntheticRun(Array(30).fill(100))

    steady.statistics = steady.statistics.map((statistics, index) => ({ ...statistics, strong: index < 15 ? 50 : 10 }))

    expect(replayAlerts(steady, { ...shippedReplay, count: 'measured' })).toEqual([])
    expect(replayAlerts(steady, { ...shippedReplay, count: 'strong' }).map(episode => episode.id)).toEqual(['stars-dropping'])
  })

  it('leaves out a frame whose statistics are of another algorithm version', () => {
    const old = syntheticRun(counts)

    old.statistics = old.statistics.map(statistics => ({ ...statistics, algorithm: { version: 2 } }))

    expect(replayAlerts(old)).toEqual([])
  })
})
