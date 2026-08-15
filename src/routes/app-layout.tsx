import { NavLink, Outlet } from 'react-router'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `transition-colors hover:text-white ${isActive ? 'text-white' : 'text-slate-400'}`

export function AppLayout() {
  return (
    <main className="mx-auto min-h-screen w-[min(60rem,calc(100%-3rem))]">
      <header className="flex items-center justify-between border-b border-vela-line py-6">
        <NavLink className="text-xl font-extrabold tracking-tight text-white no-underline" to="/">
          <span aria-hidden="true" className="text-vela-cyan">✦</span> Vela
        </NavLink>
        <nav aria-label="Main navigation" className="flex gap-4">
          <NavLink className={navLinkClass} to="/" end>Home</NavLink>
          <NavLink className={navLinkClass} to="/api">API</NavLink>
        </nav>
      </header>
      <Outlet />
    </main>
  )
}
