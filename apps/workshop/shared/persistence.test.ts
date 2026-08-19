import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE, DEFAULT_SESSION, DEFAULT_THEME_PARAMETERS } from '@vela/ui/themes'
import { parseProfile, parseSession } from './persistence'

const profile = {
  schemaVersion: 1 as const,
  id: 'field-night',
  name: 'Field Night',
  baselineId: DEFAULT_PROFILE.id,
  baselineFingerprint: DEFAULT_PROFILE.baselineFingerprint,
  overrides: {},
}

const session = {
  ...DEFAULT_SESSION,
  updatedAt: new Date().toISOString(),
}

describe('local persistence boundary', () => {
  it('accepts named profiles with complete status-ramp overrides', () => {
    const parsed = parseProfile({
      ...profile,
      overrides: {
        positiveHue: 152,
        positiveLightness: [...DEFAULT_THEME_PARAMETERS.positiveLightness],
      },
    })

    expect(parsed.id).toBe('field-night')
    expect(parsed.overrides.positiveHue).toBe(152)
  })

  it('rejects unsafe, read-only, or malformed profiles', () => {
    expect(() => parseProfile({ ...profile, id: '../outside' })).toThrow('Invalid design profile payload')
    expect(() => parseProfile({ ...profile, readonly: true })).toThrow('Read-only profiles cannot be persisted')
    expect(() => parseProfile({ ...profile, overrides: { dangerLightness: [0.5] } })).toThrow('Invalid design profile payload')
  })

  it('accepts complete working-session recovery state', () => {
    const parsed = parseSession({
      ...session,
      componentId: 'tabs',
      specimenId: 'tabs-device',
      props: { selected: 'settings', compact: true },
      unsavedOverrides: { warningHue: 88 },
    })

    expect(parsed.props.selected).toBe('settings')
    expect(parsed.unsavedOverrides.warningHue).toBe(88)
  })

  it('rejects arbitrary paths, nested props, and malformed recovery state', () => {
    expect(() => parseSession({ ...session, context: 'arbitrary' })).toThrow('Invalid workshop session payload')
    expect(() => parseSession({ ...session, props: { nested: {} } })).toThrow('Invalid workshop session payload')
    expect(() => parseSession({ ...session, unsavedOverrides: { positiveLightness: [0.5] } })).toThrow('Invalid workshop session payload')
  })
})
