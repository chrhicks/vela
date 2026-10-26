import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { starAlgorithmVersion } from '../imaging/statistics.js'
import { defaultThresholds, thresholdsSchema } from './thresholds.js'

describe('the comment on the thresholds', () => {
  it('names the star measurement version the bench output was taken at, so a new version cannot leave it stale', () => {
    const source = readFileSync(new URL('./thresholds.ts', import.meta.url), 'utf8')

    expect(source.match(/star\s+\*\s+measurement version (\d+),/)?.[1]).toBe(String(starAlgorithmVersion))
  })
})

describe('the cause thresholds', () => {
  it('have defaults, so an alerts.json written before they existed still parses', () => {
    expect(defaultThresholds).toMatchObject({
      causeSkyRatio: 1.5,
      causeTrailedAxisRatio: 1.7,
      causeBlendedShareRise: 0.4,
      causePeaksRatio: 0.5,
    })
  })
})

describe('alerts.json overrides', () => {
  it('still win over the defaults, for the star ratios and the cause numbers alike', () => {
    const parsed = thresholdsSchema.parse({ starsDecliningRatio: 0.55, causeSkyRatio: 2 })

    expect(parsed).toMatchObject({ starsDecliningRatio: 0.55, causeSkyRatio: 2, causePeaksRatio: 0.5 })
  })
})
