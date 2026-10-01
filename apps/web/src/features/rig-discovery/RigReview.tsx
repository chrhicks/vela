import type { DiscoveryCandidateView } from '@vela/model/rig'
import { Input } from '@vela/ui'

interface Props {
  adding: boolean
  candidate: DiscoveryCandidateView
  error?: string
  rigName: string
  onRigNameChange(name: string): void
}

export function RigReview({ adding, candidate, error, rigName, onRigNameChange }: Props) {
  return (
    <>
      <Input
        disabled={adding}
        label="Rig name"
        onChange={(event) => onRigNameChange(event.target.value)}
        value={rigName}
      />
      <p className="vela-rig-onboarding__endpoint">
        Found at {candidate.endpoint.host} · Port {candidate.endpoint.port}
      </p>
      <p className="vela-rig-onboarding__device-count">
        {candidate.devices.length} devices available
      </p>
      <ul className="vela-rig-onboarding__devices">
        {candidate.devices.map((device, index) => (
          <li key={`${device.kind}-${index}`}>
            <span>{device.name}</span>
            <span>
              {device.kind === 'telescope'
                ? 'Mount'
                : device.kind
                    .split('-')
                    .map((part) => part[0].toUpperCase() + part.slice(1))
                    .join(' ')}
            </span>
          </li>
        ))}
      </ul>
      <p className="vela-rig-onboarding__review-consequence">
        Adding saves this rig in Vela. Connect its devices from Equipment when you’re ready.
      </p>
      {error && (
        <aside className="vela-rig-onboarding__warning" role="alert">
          {error}
        </aside>
      )}
    </>
  )
}
