// Feature-owned artwork from the approved observation-readiness workshop specimen.
export function ObservationMark() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 28 28">
      <path d="m6 11 12-5 2.7 5.7-12 5L6 11Z" />
      <path d="m10 16 4 3m-1-1-3 7m3-7 6 6M4.5 9.5l3 8" />
      <path d="M22 3v4m-2-2h4" />
    </svg>
  )
}

export function ConnectionMark({ busy, tone }: { busy: boolean; tone: string }) {
  if (busy) return <span className="vela-observe-spinner" />
  if (tone === 'positive') return <span>✓</span>
  if (tone === 'danger') return <span>×</span>
  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8Z" />
      <path d="M12 17v4" />
    </svg>
  )
}
