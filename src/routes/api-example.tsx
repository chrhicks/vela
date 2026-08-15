import { useState } from 'react'
import { ApiError, api } from '../lib/api'

type HealthResponse = { status: string }

export function ApiExample() {
  const [result, setResult] = useState<string>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)

  async function checkApi() {
    setLoading(true)
    setError(undefined)

    try {
      const health = await api<HealthResponse>('health')
      setResult(`API status: ${health.status}`)
    } catch (caught) {
      setResult(undefined)
      setError(
        caught instanceof ApiError
          ? `${caught.message}. Configure an API endpoint before using this example.`
          : 'The API could not be reached.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="py-[clamp(4rem,14vh,9rem)]" aria-labelledby="api-title">
      <p className="mb-3 text-xs font-extrabold tracking-[0.14em] text-vela-cyan uppercase">
        Integration point
      </p>
      <h1 id="api-title" className="text-[clamp(2.75rem,8vw,5.5rem)] leading-[.95] font-bold tracking-[-.06em]">
        API client
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-vela-muted">
        Requests use <code className="rounded bg-slate-800 px-1 py-0.5">VITE_API_URL</code> (default{' '}
        <code className="rounded bg-slate-800 px-1 py-0.5">/api</code>). In development, set{' '}
        <code className="rounded bg-slate-800 px-1 py-0.5">API_PROXY_TARGET</code> to send those requests through Vite to your backend.
      </p>
      <div className="mt-10 max-w-2xl rounded-2xl border border-vela-line bg-vela-surface p-6">
        <button
          type="button"
          onClick={checkApi}
          disabled={loading}
          className="cursor-pointer rounded-lg bg-vela-cyan px-4 py-3 font-bold text-vela-night transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? 'Checking…' : 'Check /api/health'}
        </button>
        {result && <p className="mt-4 text-vela-success">{result}</p>}
        {error && <p className="mt-4 text-vela-danger" role="alert">{error}</p>}
      </div>
    </section>
  )
}
