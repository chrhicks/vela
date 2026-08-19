import { DEFAULT_THEME_PARAMETERS, BASELINE_FINGERPRINT } from './defaults'
import { RAMP_NAMES, RAMP_STEPS, SEMANTIC_TOKEN_KEYS } from './types'
import type { DesignProfile, ReferenceToken, SemanticMapping, ThemeMode, ThemeParameters, WorkingSession } from './types'

const numericThemeKeys = new Set([
  'neutralHue', 'neutralChroma', 'accentHue', 'accentChroma', 'positiveHue', 'positiveChroma',
  'warningHue', 'warningChroma', 'dangerHue', 'dangerChroma', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'spacingUnit', 'radius', 'borderWidth', 'controlHeight',
  'panelPadding', 'density',
])
const lightnessKeys = RAMP_NAMES.map((ramp) => `${ramp}Lightness`)
const themeKeys = new Set([...numericThemeKeys, ...lightnessKeys, 'fontStack', 'semantic'])

const fontStacks = {
  sans: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Iowan Old Style, Charter, Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const

export function resolveTheme(profile: DesignProfile, scratch: Partial<ThemeParameters> = {}): ThemeParameters {
  return {
    ...DEFAULT_THEME_PARAMETERS,
    ...profile.overrides,
    ...scratch,
    semantic: scratch.semantic ?? profile.overrides.semantic ?? DEFAULT_THEME_PARAMETERS.semantic,
    neutralLightness: scratch.neutralLightness ?? profile.overrides.neutralLightness ?? DEFAULT_THEME_PARAMETERS.neutralLightness,
    accentLightness: scratch.accentLightness ?? profile.overrides.accentLightness ?? DEFAULT_THEME_PARAMETERS.accentLightness,
    positiveLightness: scratch.positiveLightness ?? profile.overrides.positiveLightness ?? DEFAULT_THEME_PARAMETERS.positiveLightness,
    warningLightness: scratch.warningLightness ?? profile.overrides.warningLightness ?? DEFAULT_THEME_PARAMETERS.warningLightness,
    dangerLightness: scratch.dangerLightness ?? profile.overrides.dangerLightness ?? DEFAULT_THEME_PARAMETERS.dangerLightness,
  }
}

function oklch(lightness: number, chroma: number, hue: number): string {
  return `oklch(${Math.round(lightness * 1000) / 1000} ${Math.round(chroma * 1000) / 1000} ${Math.round(hue)})`
}

export function referencePalette(theme: ThemeParameters): Record<ReferenceToken, string> {
  const entries: [ReferenceToken, string][] = []
  for (const ramp of RAMP_NAMES) {
    const lightness = theme[`${ramp}Lightness`]
    const chroma = theme[`${ramp}Chroma`]
    const hue = theme[`${ramp}Hue`]
    for (const [index, step] of RAMP_STEPS.entries()) {
      entries.push([`${ramp}-${step}`, oklch(lightness[index] ?? 0.5, chroma, hue)])
    }
  }
  return Object.fromEntries(entries) as Record<ReferenceToken, string>
}

export function themeStyle(theme: ThemeParameters, mode: ThemeMode): Record<string, string> {
  const palette = referencePalette(theme)
  const semantic = theme.semantic[mode]
  const density = theme.density
  const style: Record<string, string> = {
    '--vela-font': fontStacks[theme.fontStack],
    '--vela-font-size': `${theme.fontSize}px`,
    '--vela-font-weight': `${theme.fontWeight}`,
    '--vela-line-height': `${theme.lineHeight}`,
    '--vela-letter-spacing': `${theme.letterSpacing}em`,
    '--vela-space': `${theme.spacingUnit * density}px`,
    '--vela-radius': `${theme.radius}px`,
    '--vela-border-width': `${theme.borderWidth}px`,
    '--vela-control-height': `${theme.controlHeight * density}px`,
    '--vela-panel-padding': `${theme.panelPadding * density}px`,
  }
  for (const key of SEMANTIC_TOKEN_KEYS) {
    const cssKey = key.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)
    style[`--vela-${cssKey}`] = palette[semantic[key]]
  }
  return style
}

export function makeProfile(id: string, name: string, overrides: Partial<ThemeParameters>): DesignProfile {
  return {
    schemaVersion: 1,
    id,
    name,
    baselineId: 'vela-ui-default',
    baselineFingerprint: BASELINE_FINGERPRINT,
    overrides,
  }
}

export function isDesignProfile(value: unknown): value is DesignProfile {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === 'string'
    && /^[a-z0-9][a-z0-9-]*$/.test(value.id)
    && typeof value.name === 'string'
    && typeof value.baselineId === 'string'
    && typeof value.baselineFingerprint === 'string'
    && isThemeOverrides(value.overrides)
}

export function isWorkingSession(value: unknown): value is WorkingSession {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.componentId === 'string'
    && typeof value.specimenId === 'string'
    && typeof value.profileId === 'string'
    && (value.mode === 'light' || value.mode === 'dark')
    && ['isolated', 'form', 'toolbar', 'card'].includes(String(value.context))
    && typeof value.viewport === 'number'
    && value.viewport >= 320
    && value.viewport <= 1600
    && typeof value.density === 'number'
    && typeof value.compareBaseline === 'boolean'
    && isPrimitiveRecord(value.props)
    && isThemeOverrides(value.unsavedOverrides)
    && typeof value.updatedAt === 'string'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isThemeOverrides(value: unknown): value is Partial<ThemeParameters> {
  if (!isRecord(value) || Object.keys(value).some((key) => !themeKeys.has(key))) return false
  for (const [key, entry] of Object.entries(value)) {
    if (numericThemeKeys.has(key) && (typeof entry !== 'number' || !Number.isFinite(entry))) return false
    if (lightnessKeys.includes(key) && !isLightnessRamp(entry)) return false
    if (key === 'fontStack' && !['sans', 'serif', 'mono'].includes(String(entry))) return false
    if (key === 'semantic' && !isSemanticPair(entry)) return false
  }
  return true
}

function isLightnessRamp(value: unknown): boolean {
  return Array.isArray(value) && value.length === RAMP_STEPS.length
    && value.every((entry) => typeof entry === 'number' && entry >= 0 && entry <= 1)
}

function isSemanticPair(value: unknown): value is Record<ThemeMode, SemanticMapping> {
  if (!isRecord(value)) return false
  return ['light', 'dark'].every((mode) => {
    const mapping = value[mode]
    return isRecord(mapping) && SEMANTIC_TOKEN_KEYS.every((key) => typeof mapping[key] === 'string' && /^(neutral|accent|positive|warning|danger)-(50|100|200|300|400|500|600|700|800|900|950)$/.test(mapping[key]))
  })
}

function isPrimitiveRecord(value: unknown): value is Record<string, string | number | boolean> {
  return isRecord(value) && Object.values(value).every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
}
