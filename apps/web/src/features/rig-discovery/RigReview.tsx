import type { DiscoveryCandidateView } from '@vela/model/rig'
import { Badge, Input } from '@vela/ui'

interface Props {
  adding: boolean
  candidate: DiscoveryCandidateView
  error?: string
  rigName: string
  onRigNameChange(name: string): void
}

export function RigReview({
  adding,
  candidate,
  error,
  rigName,
  onRigNameChange,
}: Props) {
  const reportedName = candidate.server?.name ?? candidate.endpoint.host

  return (
    <div className="rig-discovery-review">
      <section className="rig-discovery-review__server">
        <div>
          <small>ALPACA SERVER</small>
          <strong>{reportedName}</strong>
          <span>{candidate.endpoint.host}:{candidate.endpoint.port}</span>
        </div>
        <Badge size="small" tone="positive">Eligible</Badge>
      </section>

      <Input
        disabled={adding}
        label="Rig name"
        message={`Reported as ${reportedName}. Keep this name or choose one that means more to you.`}
        onChange={(event) => onRigNameChange(event.target.value)}
        value={rigName}
      />

      {error ? (
        <div className="rig-discovery-review__error" role="alert">{error}</div>
      ) : null}

      <section>
        <div className="rig-discovery-review__heading">
          <strong>Configured devices</strong>
          <span>{candidate.devices.length} found</span>
        </div>
        <ul className="rig-discovery-review__devices">
          {candidate.devices.map((device, index) => (
            <li key={`${device.kind}-${device.name}-${index}`}>
              <span aria-hidden="true">{device.kind.slice(0, 1).toUpperCase()}</span>
              <p>
                <strong>{device.name}</strong>
                <small>{deviceKindLabel(device.kind)}</small>
              </p>
            </li>
          ))}
        </ul>
      </section>

      {!error ? (
        <div className="rig-discovery-review__notice">
          <strong>Ready to add</strong>
          <p>Adding saves this Rig in Vela. It does not connect devices or change the Alpaca server.</p>
        </div>
      ) : null}
    </div>
  )
}

function deviceKindLabel(kind: DiscoveryCandidateView['devices'][number]['kind']) {
  return kind
    .split('-')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
