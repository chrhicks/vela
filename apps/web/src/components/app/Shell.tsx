import { VELA_CURRENT_PROFILE, resolveTheme, themeStyle } from '@vela/ui'
import type { CSSProperties } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { classes } from '../ui/utils'

const theme = resolveTheme(VELA_CURRENT_PROFILE)

export default function Shell() {
  const { pathname } = useLocation()
  const rigsActive = pathname === '/' || pathname.startsWith('/rigs/')

  return (
    <div
      className="vela-theme min-h-screen"
      style={themeStyle(theme, 'dark') as CSSProperties}
    >
      <header className="bg-ui-surface flex items-center min-h-13 px-3 border-0 border-b border-b-ui-line overflow-hidden">
        <div className="flex h-full shrink-0">
          <span className="h-7 w-7 border border-ui-accent grid place-items-center font-bold text-ui-accent">
            V
          </span>
          <span className="uppercase font-bold grid place-items-center px-2">Vela</span>
        </div>

        <nav aria-label="Main navigation" className="flex self-stretch min-w-0 overflow-x-auto px-3 sm:px-6 lg:px-12">
          <Link
            aria-current={rigsActive ? 'page' : undefined}
            className={classes(
              'relative grid shrink-0 place-items-center min-w-14.5 uppercase text-xs text-ui-muted px-2.5 hover:text-ui-text',
              'after:absolute after:right-2.5 after:bottom-0 after:left-2.5 after:h-0.5 after:origin-center',
              "after:content-[''] after:transition-transform",
              rigsActive
                ? 'bg-ui-surface-raised after:bg-ui-focus after:scale-x-100 text-ui-text'
                : 'hover:bg-ui-surface-raised hover:after:scale-x-100 after:bg-ui-muted after:scale-x-0',
            )}
            to="/"
          >
            Rigs
          </Link>
        </nav>
      </header>
      <main><Outlet /></main>
      <footer />
    </div>
  )
}
