import { describe, expect, it } from 'vitest'
import { readAppConfig } from './config'

describe('application configuration', () => {
  it('defaults to Fieldroom and keeps the legacy token reference selectable', () => {
    expect(readAppConfig({}).identity).toBe('fieldroom')
    expect(readAppConfig({ VITE_THEME: 'vela-current' }).identity).toBe('vela-current')
  })
  it('rejects unknown or empty identities instead of silently changing themes', () => {
    expect(() => readAppConfig({ VITE_THEME: 'typo' })).toThrow('Invalid VITE_THEME')
    expect(() => readAppConfig({ VITE_THEME: '' })).toThrow('Invalid VITE_THEME')
  })
})
