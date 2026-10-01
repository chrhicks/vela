import { themeStyle } from '@vela/ui'
import type { AppearancePreference, ThemeMode, ThemeParameters } from '@vela/ui'

export const APPEARANCE_STORAGE_KEY = 'vela.appearance'

export interface AppearanceState {
  preference: AppearancePreference
  systemMode: ThemeMode
  mode: ThemeMode
  persistence: 'saved' | 'visit'
}

interface AppearanceBrowser {
  readonly localStorage: Pick<Storage, 'getItem' | 'setItem'>
  matchMedia(query: string): {
    readonly matches: boolean
    addEventListener(type: 'change', listener: () => void): void
    removeEventListener(type: 'change', listener: () => void): void
  }
}

export function createBrowserAppearance(browser: AppearanceBrowser, apply: (mode: ThemeMode) => void) {
  const media = browser.matchMedia('(prefers-color-scheme: dark)')
  let preference: AppearancePreference = 'system'
  let persistence: AppearanceState['persistence'] = 'visit'

  try {
    const stored = browser.localStorage.getItem(APPEARANCE_STORAGE_KEY)

    if (stored === 'system' || stored === 'light' || stored === 'dark') {
      preference = stored
      persistence = 'saved'
    }
  } catch {
    // Storage may be blocked; appearance still works for this visit.
  }

  const systemMode = media.matches ? 'dark' : 'light'

  let state: AppearanceState = {
    preference, systemMode, persistence,
    mode: preference === 'system' ? systemMode : preference,
  }

  const listeners = new Set<() => void>()
  apply(state.mode)

  function publish(next: AppearanceState) {
    state = next
    apply(state.mode)

    for (const listener of listeners) listener()
  }

  function systemChanged() {
    const systemMode = media.matches ? 'dark' : 'light'
    publish({ ...state, systemMode, mode: state.preference === 'system' ? systemMode : state.preference })
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        media.addEventListener('change', systemChanged)
        systemChanged()
      }

      listeners.add(listener)

      return () => {
        listeners.delete(listener)

        if (listeners.size === 0) media.removeEventListener('change', systemChanged)
      }
    },
    setPreference(preference: AppearancePreference) {
      let persistence: AppearanceState['persistence'] = 'saved'

      try {
        browser.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference)
      } catch {
        persistence = 'visit'
      }

      publish({ ...state, preference, persistence, mode: preference === 'system' ? state.systemMode : preference })
    },
  }
}

export type BrowserAppearance = ReturnType<typeof createBrowserAppearance>

export function applyRootAppearance(document: Document, theme: ThemeParameters, mode: ThemeMode) {
  const variables = themeStyle(theme, mode)

  for (const [key, value] of Object.entries(variables)) document.documentElement.style.setProperty(key, String(value))
  document.documentElement.style.colorScheme = mode
  document.documentElement.dataset.mode = mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', variables['--vela-canvas'])
}
