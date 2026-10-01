import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE,
  DEFAULT_SESSION,
  DEFAULT_THEME_PARAMETERS,
  FIELDROOM_PROFILE,
  VELA_CURRENT_PROFILE,
} from './defaults'
import {
  designProfileSchema,
  isDesignProfile,
  isWorkingSession,
  referencePalette,
  resolveTheme,
  themeStyle,
  semanticPalette,
} from './runtime'

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
    const theme = resolveTheme(
      { ...DEFAULT_PROFILE, overrides: { radius: 12, spacingUnit: 5 } },
      { radius: 6, density: 0.85 },
    )

    expect(theme.radius).toBe(6)
    expect(theme.spacingUnit).toBe(5)
    expect(theme.density).toBe(0.85)
    expect(DEFAULT_THEME_PARAMETERS.radius).toBe(8)
  })

  it('uses the approved paired Fieldroom palette, including distinct action and feedback states', () => {
    const theme = resolveTheme(FIELDROOM_PROFILE)
    expect(semanticPalette(theme, 'light')).toMatchObject({
      canvas: '#F1EEE5',
      text: '#293C36',
      textMuted: '#50614F',
      accent: '#304638',
      accentText: '#F1EEE5',
      accentHover: '#405B48',
      accentPressed: '#25362B',
      warningSurface: '#ECE1CD',
      warning: '#72532E',
      dangerSurface: '#EBDCD4',
      danger: '#8B4838',
      pendingSurface: '#E5E3D7',
      progressTrack: '#B7C2A7',
    })
    expect(semanticPalette(theme, 'dark')).toMatchObject({
      canvas: '#141715',
      text: '#DDE1D7',
      textMuted: '#A8B4A7',
      accent: '#B8CDA8',
      accentText: '#141715',
      accentHover: '#C7D9BA',
      accentPressed: '#A8C096',
      warningSurface: '#382F20',
      warning: '#E0C28F',
      dangerSurface: '#3B2925',
      danger: '#E2B09B',
      pendingSurface: '#263127',
      progressTrack: '#4A5847',
    })
  })

  it('edits one scratch color without losing either mode or mutating the saved profile', () => {
    const theme = resolveTheme(FIELDROOM_PROFILE, {
      colorOverrides: {
        light: { ...FIELDROOM_PROFILE.overrides.colorOverrides?.light, accent: '#123456' },
      },
    })

    expect(semanticPalette(theme, 'light').accent).toBe('#123456')
    expect(semanticPalette(theme, 'light').canvas).toBe('#F1EEE5')
    expect(semanticPalette(theme, 'dark').accent).toBe('#B8CDA8')
    expect(FIELDROOM_PROFILE.overrides.colorOverrides?.light?.accent).toBe('#304638')
  })

  it('allows clearing one mode back to generated colors without resetting the other mode', () => {
    const theme = resolveTheme(FIELDROOM_PROFILE, { colorOverrides: { light: {} } })
    expect(semanticPalette(theme, 'light').accent).toBe(referencePalette(theme)[theme.semantic.light.accent])
    expect(semanticPalette(theme, 'dark').accent).toBe('#B8CDA8')
  })

  it('emits separate Fieldroom typography and geometry roles while retaining legacy token values', () => {
    const fieldroom = themeStyle(resolveTheme(FIELDROOM_PROFILE), 'light')
    expect(fieldroom['--vela-font']).toMatch(/^Barlow,/)
    expect(fieldroom['--vela-font-heading']).toMatch(/^"Space Grotesk",/)
    expect(fieldroom['--vela-control-height']).toBe('46px')
    expect(fieldroom['--vela-icon-target']).toBe('44px')
    expect(fieldroom['--vela-radius']).toBe('4px')
    expect(fieldroom['--vela-card-radius']).toBe('6px')
    expect(fieldroom['--vela-overlay-radius']).toBe('8px')
    expect(fieldroom['--vela-focus-offset']).toBe('3px')
    expect(fieldroom['--vela-pending-surface']).toBe('#E5E3D7')
    expect(fieldroom['--vela-progress-track']).toBe('#B7C2A7')

    const legacy = resolveTheme(VELA_CURRENT_PROFILE)
    const legacyStyle = themeStyle(legacy, 'dark')
    expect(legacyStyle['--vela-radius']).toBe('2px')
    expect(legacyStyle['--vela-control-height']).toBe('34px')
    expect(legacyStyle['--vela-text']).toBe(referencePalette(legacy)[legacy.semantic.dark.text])
    expect(legacyStyle['--vela-font-heading']).toBe(legacyStyle['--vela-font'])
  })
})

describe('shared artifact schemas', () => {
  it('round-trips Fieldroom colors, fonts and geometry through the profile schema', () => {
    const parsed: unknown = designProfileSchema.parse(JSON.parse(JSON.stringify(FIELDROOM_PROFILE)))
    expect(parsed).toEqual(FIELDROOM_PROFILE)

    if (!isDesignProfile(parsed)) throw new Error('Parsed Fieldroom profile is invalid')
    expect(themeStyle(resolveTheme(parsed), 'dark')['--vela-accent-hover']).toBe('#C7D9BA')
  })

  it.each([
    { light: { canvas: 'red' } },
    { light: { canvas: '#FFF' } },
    { light: { canvas: '#GGGGGG' } },
    { light: { arbitraryColor: '#123456' } },
    { sepia: { canvas: '#123456' } },
  ])('rejects unsupported exact palette input: %j', colorOverrides => {
    expect(isDesignProfile({ ...DEFAULT_PROFILE, overrides: { colorOverrides } })).toBe(false)
  })

  it('preserves the reference profile lock when parsing persisted profiles', () => {
    expect(designProfileSchema.parse({ ...DEFAULT_PROFILE, readonly: true }).readonly).toBe(true)
  })

  it('accepts a named profile with status-ramp overrides', () => {
    expect(
      isDesignProfile({
        schemaVersion: 1,
        id: 'field-night',
        name: 'Field Night',
        baselineId: DEFAULT_PROFILE.id,
        baselineFingerprint: DEFAULT_PROFILE.baselineFingerprint,
        overrides: {
          dangerHue: 24,
          dangerLightness: [...DEFAULT_THEME_PARAMETERS.dangerLightness],
        },
      }),
    ).toBe(true)
  })

  it('rejects incomplete ramps and unknown theme properties', () => {
    expect(
      isDesignProfile({
        ...DEFAULT_PROFILE,
        readonly: false,
        overrides: { warningLightness: [0.5] },
      }),
    ).toBe(false)
    expect(
      isDesignProfile({ ...DEFAULT_PROFILE, readonly: false, overrides: { magicColor: '#fff' } }),
    ).toBe(false)
    expect(isDesignProfile({ ...DEFAULT_PROFILE, overrides: { radius: undefined } })).toBe(false)
  })

  it('accepts a recoverable working session and rejects invalid state', () => {
    expect(isWorkingSession({ ...DEFAULT_SESSION, updatedAt: new Date().toISOString() })).toBe(true)
    expect(isWorkingSession({ ...DEFAULT_SESSION, viewport: 200 })).toBe(false)
    expect(isWorkingSession({ ...DEFAULT_SESSION, props: { nested: {} } })).toBe(false)
  })
})
