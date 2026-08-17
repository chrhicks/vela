import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router";
import { classes } from "../ui/utils";

export default function Shell() {
  return (
    <div>
      <header className="bg-ui-surface flex items-center min-h-13 px-3 border-0 border-b border-b-ui-line">
        <section className="flex h-full">
          <span className="h-7 w-7 border border-ui-accent grid place-items-center font-bold text-ui-accent">
            V
          </span>
          <section className="uppercase font-bold grid place-items-center px-2">Vela</section>
        </section>

        <nav className="flex self-stretch min-w-0 px-12">
          <Link to="/plan" active>Plan</Link>
          <Link to="/observe">Observe</Link>
          <Link to="/library">Library</Link>
          <Link to="/process">Process</Link>
          <Link to="/develop">Develop</Link>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer></footer>
    </div>
  );
}

function Link({ to, children, active }: { to: string, children: ReactNode, active?:boolean }) {
	return (
		<NavLink 
			className={classes(
        'relative grid place-items-center min-w-14.5 uppercase text-xs text-ui-muted px-2.5 hover:text-ui-text',
        'after:absolute after:right-2.5 after:bottom-0 after:left-2.5 after:h-0.5 after:origin-center ',
        "after:content-[''] after:transition-transform ",
        active ? 'bg-ui-surface-raised after:bg-ui-focus after:scale-x-100'
                  : 'hover:bg-ui-surface-raised hover:after:scale-x-100 after:bg-ui-muted after:scale-x-0 '
      )}
			to={to}
		>
			{children}
		</NavLink>
	)
}