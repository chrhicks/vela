import { Input } from '@vela/ui'

export const manualDiscoveryFormId = 'rig-discovery-manual-form'

export const manualHostId = 'rig-discovery-host'

export const manualPortId = 'rig-discovery-port'

interface Props {
  host: string
  port: string
  error?: string
  portError?: string
  warning?: string
  onHostChange(host: string): void
  onPortChange(port: string): void
  onSubmit(): void
}

export function ManualDiscoveryForm({
  host,
  port,
  error,
  portError,
  warning,
  onHostChange,
  onPortChange,
  onSubmit,
}: Props) {
  return (
    <>
      <p className="vela-rig-onboarding__intro">Enter the computer running your ALPACA server.</p>
      <form
        id={manualDiscoveryFormId}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="vela-rig-onboarding__address-fields">
          <Input
            id={manualHostId}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            invalid={Boolean(error)}
            message={error}
            label="Host or IP address"
            onChange={(event) => onHostChange(event.target.value)}
            value={host}
          />
          <Input
            id={manualPortId}
            inputMode="numeric"
            label="Port"
            invalid={Boolean(portError)}
            message={portError}
            onChange={(event) => onPortChange(event.target.value)}
            value={port}
          />
        </div>
        {!error && (
          <p className="vela-rig-onboarding__address-help">
            Use a hostname or IP address, without http:// or a path.
          </p>
        )}
        {warning && (
          <aside className="vela-rig-onboarding__warning" role="alert">
            <strong>Could not reach this server</strong>
            <p>{warning}</p>
          </aside>
        )}
      </form>
    </>
  )
}
