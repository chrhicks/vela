export function Home() {
  return (
    <section className="py-[clamp(4rem,14vh,9rem)]" aria-labelledby="page-title">
      <p className="mb-3 text-xs font-extrabold tracking-[0.14em] text-ui-accent uppercase">
        Astronomy, in focus
      </p>
      <h1 id="page-title" className="max-w-3xl text-[clamp(2.75rem,8vw,5.5rem)] leading-[.95] font-bold tracking-[-.06em]">
        Your React SPA is ready.
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ui-muted">
        Vite provides a fast development server and production build; React Router owns
        client-side navigation without turning this into a heavyweight framework.
      </p>
      <div className="mt-10 max-w-2xl rounded-ui border border-ui-line bg-ui-surface p-[var(--ui-panel-padding)]">
        <h2 className="text-xl font-bold">What is included</h2>
        <ul className="mt-4 space-y-2 pl-5 text-ui-muted marker:text-ui-accent">
          <li>React 19 and TypeScript with strict compiler settings</li>
          <li>React Router browser routes with a layout and example page</li>
          <li>A typed fetch client and optional Vite development API proxy</li>
          <li>Tailwind CSS v4 and production build scripts</li>
        </ul>
      </div>
    </section>
  )
}
