export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export type RampStep = (typeof RAMP_STEPS)[number]

export type ThemeMode = 'light' | 'dark'

export type FontStack = 'sans' | 'serif' | 'mono' | 'barlow' | 'space-grotesk'

export const RAMP_NAMES = ['neutral', 'accent', 'positive', 'warning', 'danger'] as const

export type RampName = (typeof RAMP_NAMES)[number]

export const SEMANTIC_TOKEN_KEYS = [
  'canvas',
  'surface',
  'surfaceRaised',
  'line',
  'lineStrong',
  'text',
  'textMuted',
  'accent',
  'accentText',
  'accentSurface',
  'positive',
  'warning',
  'danger',
  'focus',
] as const

export type SemanticTokenKey = (typeof SEMANTIC_TOKEN_KEYS)[number]

export const SEMANTIC_COLOR_KEYS = [
  ...SEMANTIC_TOKEN_KEYS,
  'accentHover',
  'accentPressed',
  'warningSurface',
  'dangerSurface',
  'pendingSurface',
] as const

export type SemanticColorKey = (typeof SEMANTIC_COLOR_KEYS)[number]

export type ColorOverrides = Partial<Record<ThemeMode, Partial<Record<SemanticColorKey, string>>>>

export type ReferenceToken = `${RampName}-${RampStep}`

export type SemanticMapping = Record<SemanticTokenKey, ReferenceToken>

export interface ThemeParameters {
  neutralHue: number
  neutralChroma: number
  accentHue: number
  accentChroma: number
  positiveHue: number
  positiveChroma: number
  warningHue: number
  warningChroma: number
  dangerHue: number
  dangerChroma: number
  neutralLightness: number[]
  accentLightness: number[]
  positiveLightness: number[]
  warningLightness: number[]
  dangerLightness: number[]
  fontStack: FontStack
  headingFontStack?: FontStack
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  spacingUnit: number
  radius: number
  borderWidth: number
  controlHeight: number
  panelPadding: number
  iconTarget?: number
  cardRadius?: number
  overlayRadius?: number
  fieldInset?: number
  buttonInset?: number
  overlayPadding?: number
  focusOffset?: number
  density: number
  semantic: Record<ThemeMode, SemanticMapping>
  colorOverrides?: ColorOverrides
}

export interface DesignProfile {
  schemaVersion: 1
  id: string
  name: string
  baselineId: string
  baselineFingerprint: string
  readonly?: boolean
  overrides: Partial<ThemeParameters>
}

export interface WorkingSession {
  schemaVersion: 1
  componentId: string
  specimenId: string
  profileId: string
  mode: ThemeMode
  context: 'isolated' | 'form' | 'toolbar' | 'card'
  viewport: number
  density: number
  compareBaseline: boolean
  props: Record<string, string | number | boolean>
  unsavedOverrides: Partial<ThemeParameters>
  updatedAt: string
}

export type ControlDefinition =
  | { type: 'select'; label: string; options: readonly string[] }
  | { type: 'boolean'; label: string }
  | { type: 'text'; label: string }

export interface ComponentSpecimen {
  componentId: string
  componentName: string
  id: string
  name: string
  description: string
  controls: Record<string, ControlDefinition>
  defaultProps: Record<string, string | number | boolean>
  render: (
    props: Record<string, string | number | boolean>,
    onPropsChange?: (patch: Record<string, string | number | boolean>) => void,
  ) => ReactNode
}

import type { ReactNode } from 'react'
