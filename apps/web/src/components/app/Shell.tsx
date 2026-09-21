import { VELA_CURRENT_PROFILE, resolveTheme, themeStyle } from '@vela/ui'
import { Outlet } from 'react-router'
import { AppNavigation } from '../../features/navigation/AppNavigation'

const theme = resolveTheme(VELA_CURRENT_PROFILE)

export default function Shell() {
  return (
    <div className="vela-theme min-h-screen" data-mode="dark" style={themeStyle(theme, 'dark')}>
      <AppNavigation />
      <main>
        <Outlet />
      </main>
      <footer />
    </div>
  )
}
