import { describe, expect, it } from 'vitest'
import { shippedReplay } from './alerts.ts'
import type { NightLabels } from './labels.ts'
import { sweepThreshold } from './sweep.ts'
import { frameTime, haze, syntheticRun } from './test-runs.ts'

const dropSweep = { threshold: 'starsDropFraction', alert: 'stars-dropping', from: 0.05, to: 0.95, step: 0.01 } as const

function night(use: NightLabels['use'], windows: NightLabels['windows']): NightLabels {
  return { night: use, target: 'Fixture Nebula', exposureSeconds: 90, use, file: `${use}.json`, windows }
}

describe('sweepThreshold', () => {
  const fallsToQuarter = syntheticRun(haze(50, 100, 20, 12, 25))

  const calibration = night('calibration', [
    { kind: 'healthy', from: frameTime(0), to: frameTime(19), note: 'quiet' },
    { kind: 'event', name: 'haze', from: frameTime(20), to: frameTime(35), expect: ['stars-dropping'], note: 'haze' },
  ])

  it('finds the range of a threshold that still catches the event, around the default', () => {
    const { calibration: range } = sweepThreshold([calibration], [fallsToQuarter], dropSweep, shippedReplay)

    expect(range).not.toBeNull()
    expect(range!.holdsAtDefault).toBe(true)
    expect(range!.lowest).toBeLessThan(0.5)
    expect(range!.highest).toBeLessThan(0.76)
    expect(range!.highest).toBeGreaterThanOrEqual(0.7)
  })

  it('keeps nights held out apart from the nights it was picked on, and overlaps them in both', () => {
    const wobble = { ...syntheticRun(Array.from({ length: 50 }, (_, index) => (index % 7 === 3 ? 40 : 100))), target: 'Held Nebula' }

    const held = {
      ...night('holdout', [{ kind: 'healthy', from: frameTime(0), to: frameTime(49), note: 'wobbly but fine' }]),
      target: 'Held Nebula',
    }

    const result = sweepThreshold([calibration, held], [fallsToQuarter, wobble], dropSweep, shippedReplay)

    expect(result.holdout).not.toBeNull()

    expect(result.both).toEqual(
      expect.objectContaining({
        lowest: Math.max(result.calibration!.lowest, result.holdout!.lowest),
        highest: Math.min(result.calibration!.highest, result.holdout!.highest),
      }),
    )
  })

  it('says no value passes when the event cannot be caught at any threshold', () => {
    const unseen = syntheticRun(Array(50).fill(100))

    expect(sweepThreshold([calibration], [unseen], dropSweep, shippedReplay).calibration).toBeNull()
  })
})
