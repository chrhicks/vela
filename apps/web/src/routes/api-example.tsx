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
      <p className="mb-3 text-xs font-extrabold tracking-[0.14em] text-ui-accent uppercase">
        Integration point
      </p>
      <h1 id="api-title" className="text-[clamp(2.75rem,8vw,5.5rem)] leading-[.95] font-bold tracking-[-.06em]">
        API client
      </h1>
      <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ui-muted">
        Requests use <code className="rounded-ui bg-ui-surface-raised px-1 py-0.5">VITE_API_URL</code> (default{' '}
        <code className="rounded-ui bg-ui-surface-raised px-1 py-0.5">/api</code>). In development, set{' '}
        <code className="rounded-ui bg-ui-surface-raised px-1 py-0.5">API_PROXY_TARGET</code> to send those requests through Vite to your backend.
      </p>
      <div className="mt-10 max-w-2xl rounded-ui border border-ui-line bg-ui-surface p-[var(--ui-panel-padding)]">
        <button
          type="button"
          onClick={checkApi}
          disabled={loading}
          className="h-[var(--ui-control-height)] cursor-pointer rounded-ui bg-ui-accent px-4 font-bold text-ui-bg transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-focus disabled:cursor-wait disabled:opacity-70"
        >
          {loading ? 'Checking…' : 'Check /api/health'}
        </button>
        {result && <p className="mt-4 text-ui-positive">{result}</p>}
        {error && <p className="mt-4 text-ui-danger" role="alert">{error}</p>}
      </div>
    </section>
  )
}
