import { Input } from '@vela/ui'

export const manualDiscoveryFormId = 'rig-discovery-manual-form'

const manualDiscoveryHostErrorId = 'rig-discovery-manual-host-error'

interface Props {
  host: string
  port: string
  error?: string
  onHostChange(host: string): void
  onPortChange(port: string): void
  onSubmit(): void
}

export function ManualDiscoveryForm({
  host,
  port,
  error,
  onHostChange,
  onPortChange,
  onSubmit,
}: Props) {
  return (
    <form
      className="rig-discovery-manual"
      id={manualDiscoveryFormId}
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="rig-discovery-manual__fields">
        <Input
          aria-describedby={error ? manualDiscoveryHostErrorId : undefined}
          aria-invalid={error ? 'true' : undefined}
          autoComplete="off"
          invalid={Boolean(error)}
          label="Host or IP address"
          onChange={event => onHostChange(event.target.value)}
          placeholder="ascom-remote.local"
          required
          value={host}
        />
        <Input
          inputMode="numeric"
          label="Port"
          max={65535}
          min={1}
          onChange={event => onPortChange(event.target.value)}
          pattern="[0-9]*"
          required
          value={port}
        />
      </div>
      {error ? (
        <p data-tone="danger" id={manualDiscoveryHostErrorId} role="alert">
          {error}
        </p>
      ) : (
        <p>
          Vela will inspect{' '}
          <strong>
            {host.trim() || 'this host'}:{port || '11111'}
          </strong>{' '}
          using the read-only Alpaca Management API.
        </p>
      )}
    </form>
  )
}
