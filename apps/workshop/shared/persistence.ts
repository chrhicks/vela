import type { DesignProfile, WorkingSession } from '@vela/ui/themes'

const numericThemeKeys = new Set([
  'neutralHue', 'neutralChroma', 'accentHue', 'accentChroma', 'positiveHue', 'positiveChroma',
  'warningHue', 'warningChroma', 'dangerHue', 'dangerChroma', 'fontSize', 'fontWeight',
  'lineHeight', 'letterSpacing', 'spacingUnit', 'radius', 'borderWidth', 'controlHeight',
  'panelPadding', 'density',
])
const lightnessKeys = ['neutralLightness', 'accentLightness', 'positiveLightness', 'warningLightness', 'dangerLightness']
const themeKeys = new Set([...numericThemeKeys, ...lightnessKeys, 'fontStack', 'semantic'])
const semanticKeys = [
  'canvas', 'surface', 'surfaceRaised', 'line', 'lineStrong', 'text', 'textMuted',
  'accent', 'accentText', 'accentSurface', 'positive', 'warning', 'danger', 'focus',
]

export interface WorkshopPersistence {
  session: WorkingSession | null
  profiles: DesignProfile[]
}

export function parseSession(value: unknown): WorkingSession {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.componentId !== 'string'
    || typeof value.specimenId !== 'string'
    || typeof value.profileId !== 'string'
    || (value.mode !== 'light' && value.mode !== 'dark')
    || !['isolated', 'form', 'toolbar', 'card'].includes(String(value.context))
    || typeof value.viewport !== 'number'
    || value.viewport < 320
    || value.viewport > 1600
    || typeof value.density !== 'number'
    || typeof value.compareBaseline !== 'boolean'
    || !isPrimitiveRecord(value.props)
    || !isThemeOverrides(value.unsavedOverrides)
    || typeof value.updatedAt !== 'string') throw new Error('Invalid workshop session payload')
  return value as unknown as WorkingSession
}

export function parseProfile(value: unknown): DesignProfile {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || typeof value.id !== 'string'
    || !isSafeProfileId(value.id)
    || typeof value.name !== 'string'
    || typeof value.baselineId !== 'string'
    || typeof value.baselineFingerprint !== 'string'
    || !isThemeOverrides(value.overrides)) throw new Error('Invalid design profile payload')
  if (value.readonly) throw new Error('Read-only profiles cannot be persisted')
  return value as unknown as DesignProfile
}

export function isSafeProfileId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isThemeOverrides(value: unknown): boolean {
  if (!isRecord(value) || Object.keys(value).some((key) => !themeKeys.has(key))) return false
  for (const [key, entry] of Object.entries(value)) {
    if (numericThemeKeys.has(key) && (typeof entry !== 'number' || !Number.isFinite(entry))) return false
    if (lightnessKeys.includes(key) && !(Array.isArray(entry) && entry.length === 11 && entry.every((item) => typeof item === 'number' && item >= 0 && item <= 1))) return false
    if (key === 'fontStack' && !['sans', 'serif', 'mono'].includes(String(entry))) return false
    if (key === 'semantic' && !isSemanticPair(entry)) return false
  }
  return true
}

function isSemanticPair(value: unknown): boolean {
  if (!isRecord(value)) return false
  return ['light', 'dark'].every((mode) => {
    const mapping = value[mode]
    return isRecord(mapping) && semanticKeys.every((key) => typeof mapping[key] === 'string' && /^(neutral|accent|positive|warning|danger)-(50|100|200|300|400|500|600|700|800|900|950)$/.test(mapping[key]))
  })
}

function isPrimitiveRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
}
