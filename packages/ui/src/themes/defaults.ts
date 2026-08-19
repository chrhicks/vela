import type { DesignProfile, SemanticMapping, ThemeParameters, WorkingSession } from './types'

const lightSemantic: SemanticMapping = {
  canvas: 'neutral-50',
  surface: 'neutral-100',
  surfaceRaised: 'neutral-200',
  line: 'neutral-300',
  lineStrong: 'neutral-500',
  text: 'neutral-950',
  textMuted: 'neutral-700',
  accent: 'accent-700',
  accentText: 'neutral-50',
  accentSurface: 'accent-100',
  positive: 'accent-800',
  warning: 'accent-700',
  danger: 'accent-900',
  focus: 'accent-600',
}

const darkSemantic: SemanticMapping = {
  canvas: 'neutral-950',
  surface: 'neutral-900',
  surfaceRaised: 'neutral-800',
  line: 'neutral-700',
  lineStrong: 'neutral-500',
  text: 'neutral-50',
  textMuted: 'neutral-400',
  accent: 'accent-400',
  accentText: 'neutral-950',
  accentSurface: 'accent-900',
  positive: 'accent-300',
  warning: 'accent-400',
  danger: 'accent-300',
  focus: 'accent-300',
}

export const DEFAULT_THEME_PARAMETERS: ThemeParameters = {
  neutralHue: 245,
  neutralChroma: 0.018,
  accentHue: 72,
  accentChroma: 0.12,
  neutralLightness: [0.985, 0.955, 0.9, 0.82, 0.7, 0.58, 0.46, 0.35, 0.25, 0.17, 0.1],
  accentLightness: [0.97, 0.93, 0.85, 0.76, 0.68, 0.6, 0.52, 0.44, 0.35, 0.27, 0.2],
  fontStack: 'sans',
  fontSize: 14,
  fontWeight: 450,
  lineHeight: 1.45,
  letterSpacing: 0,
  spacingUnit: 4,
  radius: 8,
  borderWidth: 1,
  controlHeight: 38,
  panelPadding: 18,
  density: 1,
  semantic: { light: lightSemantic, dark: darkSemantic },
}

export const BASELINE_ID = 'vela-ui-default'
export const BASELINE_FINGERPRINT = 'vela-ui-default-v1-2026-08-19'

export const DEFAULT_PROFILE: DesignProfile = {
  schemaVersion: 1,
  id: BASELINE_ID,
  name: 'Vela UI Default',
  baselineId: BASELINE_ID,
  baselineFingerprint: BASELINE_FINGERPRINT,
  readonly: true,
  overrides: {},
}

export const VELA_CURRENT_PROFILE: DesignProfile = {
  schemaVersion: 1,
  id: 'vela-current',
  name: 'Vela Current',
  baselineId: BASELINE_ID,
  baselineFingerprint: BASELINE_FINGERPRINT,
  readonly: true,
  overrides: {
    neutralHue: 240,
    neutralChroma: 0.025,
    accentHue: 76,
    accentChroma: 0.095,
    radius: 2,
    controlHeight: 34,
    panelPadding: 12,
    fontSize: 13,
  },
}

export const DEFAULT_SESSION: WorkingSession = {
  schemaVersion: 1,
  componentId: 'button',
  specimenId: 'button-primary',
  profileId: DEFAULT_PROFILE.id,
  mode: 'dark',
  context: 'isolated',
  viewport: 920,
  density: 1,
  compareBaseline: false,
  props: {},
  unsavedOverrides: {},
  updatedAt: new Date(0).toISOString(),
}
