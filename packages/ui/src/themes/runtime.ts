import { z } from 'zod'
import type { CSSProperties } from 'react'
import { DEFAULT_THEME_PARAMETERS, BASELINE_FINGERPRINT } from './defaults'
import { RAMP_NAMES, RAMP_STEPS, SEMANTIC_TOKEN_KEYS } from './types'
import type { DesignProfile, ReferenceToken, ThemeMode, ThemeParameters, WorkingSession } from './types'

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

  // SAFETY: the nested loops enumerate every ramp and step in ReferenceToken.
  return Object.fromEntries(entries) as Record<ReferenceToken, string>
}

type ThemeStyle = CSSProperties & Record<`--vela-${string}`, string>

export function themeStyle(theme: ThemeParameters, mode: ThemeMode): ThemeStyle {
  const palette = referencePalette(theme)
  const semantic = theme.semantic[mode]
  const density = theme.density

  const style: ThemeStyle = {
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

const referenceTokenSchema = z.templateLiteral([
  z.enum(RAMP_NAMES),
  '-',
  z.enum(['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'])
])

const semanticMappingSchema = z.object({
  canvas: referenceTokenSchema,
  surface: referenceTokenSchema,
  surfaceRaised: referenceTokenSchema,
  line: referenceTokenSchema,
  lineStrong: referenceTokenSchema,
  text: referenceTokenSchema,
  textMuted: referenceTokenSchema,
  accent: referenceTokenSchema,
  accentText: referenceTokenSchema,
  accentSurface: referenceTokenSchema,
  positive: referenceTokenSchema,
  warning: referenceTokenSchema,
  danger: referenceTokenSchema,
  focus: referenceTokenSchema,
})

const lightnessRampSchema = z.array(z.number().min(0).max(1)).length(RAMP_STEPS.length)

export const themeOverridesSchema = z.strictObject({
  neutralHue: z.number().optional(),
  neutralChroma: z.number().optional(),
  accentHue: z.number().optional(),
  accentChroma: z.number().optional(),
  positiveHue: z.number().optional(),
  positiveChroma: z.number().optional(),
  warningHue: z.number().optional(),
  warningChroma: z.number().optional(),
  dangerHue: z.number().optional(),
  dangerChroma: z.number().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  spacingUnit: z.number().optional(),
  radius: z.number().optional(),
  borderWidth: z.number().optional(),
  controlHeight: z.number().optional(),
  panelPadding: z.number().optional(),
  density: z.number().optional(),
  neutralLightness: lightnessRampSchema.optional(),
  accentLightness: lightnessRampSchema.optional(),
  positiveLightness: lightnessRampSchema.optional(),
  warningLightness: lightnessRampSchema.optional(),
  dangerLightness: lightnessRampSchema.optional(),
  fontStack: z.enum(['sans', 'serif', 'mono']).optional(),
  semantic: z.object({ light: semanticMappingSchema, dark: semanticMappingSchema }).optional(),
}).refine(value => Object.values(value).every(entry => entry !== undefined))

export const designProfileSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string(),
  readonly: z.boolean().optional(),
  baselineId: z.string(),
  baselineFingerprint: z.string(),
  overrides: themeOverridesSchema,
})

export const workingSessionSchema = z.object({
  schemaVersion: z.literal(1),
  componentId: z.string(),
  specimenId: z.string(),
  profileId: z.string(),
  mode: z.enum(['light', 'dark']),
  context: z.enum(['isolated', 'form', 'toolbar', 'card']),
  viewport: z.number().min(320).max(1600),
  density: z.number(),
  compareBaseline: z.boolean(),
  props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  unsavedOverrides: themeOverridesSchema,
  updatedAt: z.string(),
})

export function isDesignProfile(value: unknown): value is DesignProfile {
  return designProfileSchema.safeParse(value).success
}

export function isWorkingSession(value: unknown): value is WorkingSession {
  return workingSessionSchema.safeParse(value).success
}
