import { describe, expect, it } from 'vitest'
import { replayAlerts } from './alerts.ts'
import type { Run } from './runs.ts'

const start = Date.parse('2030-01-01T02:00:00Z')

const interval = 90_000

function run(counts: number[], hfrPixels = 2): Run {
  return {
    target: 'Fixture Nebula',
    exposureSeconds: 90,
    frames: counts.map((stars, index) => ({ capturedAt: start + index * interval, stars, hfrPixels })),
    statistics: [],
  }
}

const frameTime = (index: number) => start + index * interval

describe('replayAlerts', () => {
  it('raises nothing on a night whose count wobbles but holds', () => {
    const wobble = Array.from({ length: 40 }, (_, index) => 100 + ((index * 7) % 21) - 10)

    expect(replayAlerts(run(wobble))).toEqual([])
  })

  it('raises stars-dropping while a haze holds the count down, and clears it once the stars return', () => {
    const counts = [...Array(15).fill(100), ...Array(10).fill(25), ...Array(15).fill(100)]
    const episodes = replayAlerts(run(counts))

    expect(episodes.map(episode => episode.id)).toEqual(['stars-dropping'])
    const [dropping] = episodes

    expect(dropping!.from).toBeGreaterThanOrEqual(frameTime(15))
    expect(dropping!.from).toBeLessThanOrEqual(frameTime(24))
    expect(dropping!.until).toBeGreaterThan(frameTime(24))
  })

  it('reports an alert still standing at the last frame as having no end', () => {
    const episodes = replayAlerts(run([...Array(15).fill(100), ...Array(10).fill(25)]))

    expect(episodes).toHaveLength(1)
    expect(episodes[0]).toMatchObject({ id: 'stars-dropping', until: null })
  })

  it('raises no-stars when a run never finds a star', () => {
    const episodes = replayAlerts(run(Array(8).fill(0), 0))

    expect(episodes.map(episode => episode.id)).toContain('no-stars')
  })

  it('raises hfr-high when the stars go soft', () => {
    const episodes = replayAlerts(run(Array(12).fill(100), 4.5))

    expect(episodes.map(episode => episode.id)).toContain('hfr-high')
  })
})
