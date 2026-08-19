export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export type RampStep = (typeof RAMP_STEPS)[number]
export type ThemeMode = 'light' | 'dark'
export type FontStack = 'sans' | 'serif' | 'mono'

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
export type ReferenceToken = `neutral-${RampStep}` | `accent-${RampStep}`
export type SemanticMapping = Record<SemanticTokenKey, ReferenceToken>

export interface ThemeParameters {
  neutralHue: number
  neutralChroma: number
  accentHue: number
  accentChroma: number
  neutralLightness: number[]
  accentLightness: number[]
  fontStack: FontStack
  fontSize: number
  fontWeight: number
  lineHeight: number
  letterSpacing: number
  spacingUnit: number
  radius: number
  borderWidth: number
  controlHeight: number
  panelPadding: number
  density: number
  semantic: Record<ThemeMode, SemanticMapping>
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
  render: (props: Record<string, string | number | boolean>) => ReactNode
}
import type { ReactNode } from 'react'
