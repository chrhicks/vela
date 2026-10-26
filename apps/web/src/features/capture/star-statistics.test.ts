import { describe, expect, it } from 'vitest'
import { skyLevel, starCounts } from './star-statistics'

const legacy = { algorithm: { version: 1 }, detectedStars: 264, medianHfrPixels: 1.6 }

describe('star statistics text', () => {
  it('says how many peaks were measured, or only the star count for an older frame', () => {
    expect(starCounts({ ...legacy, detections: 1141, measured: 264 })).toBe('264 measured of 1141 peaks')
    expect(starCounts({ ...legacy, detectedStars: 1, detections: 1, measured: 1 })).toBe('1 measured of 1 peak')
    expect(starCounts({ ...legacy, detectedStars: 0, medianHfrPixels: null, detections: 12 })).toBe('0 measured of 12 peaks')
    expect(starCounts(legacy)).toBe('264 stars')
  })

  it('rounds the sky to four significant figures and has none for an older frame', () => {
    expect(skyLevel({ ...legacy, sky: 539.2518 })).toBe('539.3')
    expect(skyLevel({ ...legacy, sky: 7148 })).toBe('7148')
    expect(skyLevel({ ...legacy, sky: 12345.6 })).toBe('12350')
    expect(skyLevel(legacy)).toBeNull()
  })
})
