import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { BrowserAppearance } from './browser-appearance'

const AppearanceContext = createContext<BrowserAppearance | undefined>(undefined)

export function AppearanceProvider({ appearance, children }: { appearance: BrowserAppearance; children: ReactNode }) {
  return <AppearanceContext value={appearance}>{children}</AppearanceContext>
}

export function useAppearance() {
  const appearance = useContext(AppearanceContext)

  if (!appearance) throw new Error('AppearanceProvider is required')
  const state = useSyncExternalStore(appearance.subscribe, appearance.getSnapshot)

  return { ...state, setPreference: appearance.setPreference }
}
