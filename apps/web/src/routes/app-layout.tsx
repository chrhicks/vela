import { NavLink, Outlet } from 'react-router'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `transition-colors hover:text-ui-text ${isActive ? 'text-ui-text' : 'text-ui-muted'}`

export function AppLayout() {
  return (
    <main className="mx-auto min-h-screen w-[min(60rem,calc(100%-3rem))]">
      <header className="flex items-center justify-between border-b border-ui-line py-6">
        <NavLink className="text-xl font-extrabold tracking-tight text-ui-text no-underline" to="/">
          <span aria-hidden="true" className="text-ui-accent">
            ✦
          </span>{' '}
          Vela
        </NavLink>
        <nav aria-label="Main navigation" className="flex gap-4">
          <NavLink className={navLinkClass} to="/" end>
            Home
          </NavLink>
          <NavLink className={navLinkClass} to="/api">
            API
          </NavLink>
        </nav>
      </header>
      <Outlet />
    </main>
  )
}
