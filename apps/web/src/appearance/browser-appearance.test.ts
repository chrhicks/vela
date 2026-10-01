import { expect, it, vi } from 'vitest'
import { APPEARANCE_STORAGE_KEY, createBrowserAppearance } from './browser-appearance'

function browser(stored: string | null = null) {
  const listeners = new Set<() => void>()

  const media = {
    matches: false,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }

  const localStorage = { getItem: vi.fn(() => stored), setItem: vi.fn() }

  return {
    matchMedia: () => media, localStorage, listeners,
    change(dark: boolean) {
      media.matches = dark

      for (const listener of listeners) listener()
    },
  }
}

it('applies a saved preference immediately and persists only the preference', () => {
  const environment = browser('dark')
  const apply = vi.fn()
  const appearance = createBrowserAppearance(environment, apply)
  expect(apply).toHaveBeenCalledWith('dark')
  expect(appearance.getSnapshot().persistence).toBe('saved')
  appearance.setPreference('light')
  expect(environment.localStorage.setItem).toHaveBeenCalledWith(APPEARANCE_STORAGE_KEY, 'light')
})

it('ignores malformed storage and follows live system changes without overriding an explicit choice', () => {
  const environment = browser('night')
  const appearance = createBrowserAppearance(environment, vi.fn())
  expect(appearance.getSnapshot().preference).toBe('system')
  const unsubscribe = appearance.subscribe(vi.fn())
  environment.change(true)
  expect(appearance.getSnapshot().mode).toBe('dark')
  appearance.setPreference('light')
  environment.change(false)
  environment.change(true)
  expect(appearance.getSnapshot().mode).toBe('light')
  appearance.setPreference('system')
  expect(appearance.getSnapshot().mode).toBe('dark')
  unsubscribe()
  expect(environment.listeners.size).toBe(0)
})

it('survives blocked storage access and reports failed writes as visit-only', () => {
  const environment = browser()
  Object.defineProperty(environment, 'localStorage', { get() { throw new Error('blocked') } })
  const appearance = createBrowserAppearance(environment, vi.fn())
  appearance.setPreference('dark')
  expect(appearance.getSnapshot()).toMatchObject({ preference: 'dark', mode: 'dark', persistence: 'visit' })
})


it('retains a new preference when a previously readable store rejects the write', () => {
  const environment = browser('light')
  environment.localStorage.setItem.mockImplementation(() => { throw new Error('Quota exceeded') })
  const appearance = createBrowserAppearance(environment, vi.fn())
  appearance.setPreference('dark')
  expect(appearance.getSnapshot()).toMatchObject({ preference: 'dark', mode: 'dark', persistence: 'visit' })
})
