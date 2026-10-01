import type { CaptureView } from '@vela/model/web'

/** Retain confirmed context without presenting a stale countdown or a usable command. */
export function CaptureInterruption({
  view,
  interruptedAt,
  warning,
}: {
  view: CaptureView
  interruptedAt: number | null
  warning: string | null
}) {
  const seconds =
    interruptedAt === null ? 0 : Math.max(0, Math.floor((Date.now() - interruptedAt) / 1000))

  const age =
    seconds < 1
      ? 'just now'
      : seconds < 60
        ? `${seconds}s ago`
        : `${Math.floor(seconds / 60)} min ago`

  const lastActivity = {
    idle: 'ready for an exposure',
    exposing: `exposing frame ${view.completedCount + 1}`,
    reading: `receiving frame ${view.completedCount + 1}`,
    saving: 'saving the received image',
    stopping: 'waiting for the camera to stop',
    stopped: 'capture stopped',
    complete: 'image received',
    failed: 'capture stopped with an error',
  }[view.phase]

  return (
    <section
      className="tonight-interruption capture-page__warning"
      aria-label="Capture images"
      role="status"
    >
      <p className="vela-type-caption">Connection interrupted <span aria-hidden="true">· {age}</span></p>
      <h2 className="vela-type-section">Capture state unknown</h2>
      <p>
        {view.active
          ? 'Your run may still be capturing. Vela is reconnecting to check its current state.'
          : 'Vela is reconnecting to check the camera’s current state. Your last received image is kept.'}
      </p>
      <p className="tonight-interruption__confirmed">
        Last confirmed: {lastActivity}.<br />
        Commands are unavailable while disconnected.
      </p>
      <div className="tonight-interruption__actions">
        <span>Reconnecting…</span>
        <details>
          <summary className="tonight-link">View details</summary>
          <p>{warning}</p>
          <p>
            {view.completedCount} completed · {view.savedCount} saved in this run. The last
            confirmed image and values remain visible.
          </p>
        </details>
      </div>
    </section>
  )
}
