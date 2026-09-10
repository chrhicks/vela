import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, DEFAULT_SESSION, DEFAULT_THEME_PARAMETERS } from './defaults'
import { designProfileSchema, isDesignProfile, isWorkingSession, referencePalette, resolveTheme, themeStyle } from './runtime'

describe('theme resolution', () => {
  it('generates all five complete OKLCH reference ramps', () => {
    const palette = referencePalette(DEFAULT_THEME_PARAMETERS)

    expect(Object.keys(palette)).toHaveLength(55)
    expect(palette['neutral-50']).toMatch(/^oklch\(/)
    expect(palette['accent-500']).toMatch(/^oklch\(/)
    expect(palette['positive-700']).toMatch(/^oklch\(/)
    expect(palette['warning-300']).toMatch(/^oklch\(/)
    expect(palette['danger-950']).toMatch(/^oklch\(/)
  })

  it('resolves distinct paired-mode semantics from the same token contract', () => {
    const theme = resolveTheme(DEFAULT_PROFILE)
    const palette = referencePalette(theme)
    const light = themeStyle(theme, 'light')
    const dark = themeStyle(theme, 'dark')

    expect(light['--vela-text']).toBe(palette[theme.semantic.light.text])
    expect(dark['--vela-text']).toBe(palette[theme.semantic.dark.text])
    expect(light['--vela-positive']).toBe(palette['positive-700'])
    expect(dark['--vela-positive']).toBe(palette['positive-300'])
    expect(light['--vela-canvas']).not.toBe(dark['--vela-canvas'])
  })

  it('applies profile and scratch overrides without mutating the default', () => {
    const theme = resolveTheme({ ...DEFAULT_PROFILE, overrides: { radius: 12, spacingUnit: 5 } }, { radius: 6, density: 0.85 })

    expect(theme.radius).toBe(6)
    expect(theme.spacingUnit).toBe(5)
    expect(theme.density).toBe(0.85)
    expect(DEFAULT_THEME_PARAMETERS.radius).toBe(8)
  })
})

describe('shared artifact schemas', () => {
  it('preserves the reference profile lock when parsing persisted profiles', () => {
    expect(designProfileSchema.parse({ ...DEFAULT_PROFILE, readonly: true }).readonly).toBe(true)
  })

  it('accepts a named profile with status-ramp overrides', () => {
    expect(isDesignProfile({
      schemaVersion: 1,
      id: 'field-night',
      name: 'Field Night',
      baselineId: DEFAULT_PROFILE.id,
      baselineFingerprint: DEFAULT_PROFILE.baselineFingerprint,
      overrides: {
        dangerHue: 24,
        dangerLightness: [...DEFAULT_THEME_PARAMETERS.dangerLightness],
      },
    })).toBe(true)
  })

  it('rejects incomplete ramps and unknown theme properties', () => {
    expect(isDesignProfile({ ...DEFAULT_PROFILE, readonly: false, overrides: { warningLightness: [0.5] } })).toBe(false)
    expect(isDesignProfile({ ...DEFAULT_PROFILE, readonly: false, overrides: { magicColor: '#fff' } })).toBe(false)
    expect(isDesignProfile({ ...DEFAULT_PROFILE, overrides: { radius: undefined } })).toBe(false)
  })

  it('accepts a recoverable working session and rejects invalid state', () => {
    expect(isWorkingSession({ ...DEFAULT_SESSION, updatedAt: new Date().toISOString() })).toBe(true)
    expect(isWorkingSession({ ...DEFAULT_SESSION, viewport: 200 })).toBe(false)
    expect(isWorkingSession({ ...DEFAULT_SESSION, props: { nested: {} } })).toBe(false)
  })
})
