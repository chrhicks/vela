import { describe, expect, it } from 'vitest'
import { alertFrame } from './frame.js'
import { starStatistics } from './test-statistics.js'

const at = Date.parse('2026-10-24T01:30:00Z')

describe('alertFrame', () => {
  it('reads the strong stars as the count and keeps what explains a change in them', () => {
    const statistics = {
      ...starStatistics(120, 1.5),
      measured: 300,
      strong: 120,
      detections: 700,
      rejected: { ...starStatistics(120, 1.5).rejected!, blended: 40 },
      sky: 690,
      axisRatio: 1.3,
    }

    expect(alertFrame(at, statistics)).toEqual({
      capturedAt: at,
      stars: 120,
      hfrPixels: 1.5,
      evidence: { peaks: 700, blended: 40, sky: 690, axisRatio: 1.3 },
    })

    expect(alertFrame(at, statistics, 'measured')!.stars).toBe(300)
  })

  it('gives no frame for a record of another algorithm version, so versions never share a history', () => {
    expect(alertFrame(at, { ...starStatistics(120, 1.5), algorithm: { version: 2 } })).toBeNull()
    expect(alertFrame(at, { ...starStatistics(120, 1.5), algorithm: { version: 1 } })).toBeNull()
  })

  it('gives no frame, never a frame of zero stars, when a named output is missing', () => {
    const { strong: _strong, ...withoutStrong } = starStatistics(120, 1.5)
    const { rejected: _rejected, ...withoutRejected } = starStatistics(120, 1.5)

    expect(alertFrame(at, withoutStrong)).toBeNull()
    expect(alertFrame(at, withoutRejected)).toBeNull()
    expect(alertFrame(at, { ...starStatistics(120, 1.5), detections: undefined })).toBeNull()
    expect(alertFrame(at, { ...starStatistics(120, 1.5), sky: undefined })).toBeNull()
    expect(alertFrame(at, { ...starStatistics(120, 1.5), sky: NaN })).toBeNull()
  })

  it('carries an unknown shape as null, not as round', () => {
    expect(alertFrame(at, { ...starStatistics(120, 1.5), axisRatio: undefined })!.evidence!.axisRatio).toBeNull()
  })
})
