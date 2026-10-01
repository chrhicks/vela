import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, FIELDROOM_PROFILE, resolveTheme } from '@vela/ui/themes'
import { contrastFindings, contrastRatio } from './diagnostics'

describe('resolved theme contrast', () => {
  it('computes hex and generated OKLCH contrast', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21)
    expect(contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 5)
    expect(contrastFindings(resolveTheme(DEFAULT_PROFILE)).every(finding => Number.isFinite(finding.ratio))).toBe(true)
  })

  it('reports overridden action colors instead of the underlying ramp', () => {
    const theme = resolveTheme(FIELDROOM_PROFILE, {
      colorOverrides: { light: { accent: '#FFFFFF', accentText: '#FFFFFF' } },
    })

    expect(contrastFindings(theme).find(finding => finding.id === 'light-accent')).toMatchObject({ ratio: 1, passes: false })
    expect(contrastFindings(theme).find(finding => finding.id === 'dark-accent')?.passes).toBe(true)
  })
})
