import { Link } from 'react-router'

export function NotFound() {
  return (
    <section className="grid justify-items-start gap-4 px-9 py-8 max-[700px]:px-5">
      <h1 className="vela-type-page">Page not found</h1>
      <p className="vela-type-body text-ui-muted">Vela has no page at this address.</p>
      <Link className="vela-button" to="/">Go to all rigs</Link>
    </section>
  )
}
