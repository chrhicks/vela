import { FIELDROOM_PROFILE, VELA_CURRENT_PROFILE, resolveTheme } from '@vela/ui'

export function readAppConfig(environment: { VITE_THEME?: string }) {
  const identity = environment.VITE_THEME ?? 'fieldroom'

  switch (identity) {
    case 'fieldroom':
      return { identity, theme: resolveTheme(FIELDROOM_PROFILE) }
    case 'vela-current':
      return { identity, theme: resolveTheme(VELA_CURRENT_PROFILE) }
    default:
      throw new Error(`Invalid VITE_THEME "${identity}". Expected fieldroom or vela-current.`)
  }
}
