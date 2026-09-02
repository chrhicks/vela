import type { DiscoveryCandidateView, DiscoveryFailureView, DiscoveryResultView } from '@vela/model/rig'
import { Badge } from '@vela/ui'

interface Props {
  result: DiscoveryResultView
  selected: DiscoveryCandidateView | null
  onSelectedChange(candidate: DiscoveryCandidateView | null): void
}

export function DiscoveryResults({ result, selected, onSelectedChange }: Props) {
  if (result.candidates.length === 0) {
    return (
      <div className="rig-discovery-results">
        <EmptyDiscoveryResult failures={result.failures} />
        <DiscoveryFailures failures={result.failures.filter((failure) => failure.reason !== 'scan-failed')} />
      </div>
    )
  }

  return (
    <div className="rig-discovery-results">
      <div className="rig-discovery-results__summary">
        <strong>{result.candidates.length} {result.candidates.length === 1 ? 'server' : 'servers'} found</strong>
        <span>Select one to continue</span>
      </div>
      <div className="rig-discovery-results__candidates">
        {result.candidates.map((candidate) => (
          <DiscoveryCandidate
            candidate={candidate}
            key={`${candidate.endpoint.host}:${candidate.endpoint.port}`}
            onSelect={() => onSelectedChange(selected === candidate ? null : candidate)}
            selected={selected === candidate}
          />
        ))}
      </div>
      <DiscoveryFailures failures={result.failures} />
    </div>
  )
}

function DiscoveryCandidate({
  candidate,
  selected,
  onSelect,
}: {
  candidate: DiscoveryCandidateView
  selected: boolean
  onSelect(): void
}) {
  const presentation = candidateDisposition(candidate)
  const visibleDevices = candidate.devices.slice(0, 4)
  const remainingDevices = candidate.devices.length - visibleDevices.length
  const content = (
    <>
      <div className="rig-discovery-candidate__heading">
        <div>
          <strong>{candidate.server?.name ?? candidate.endpoint.host}</strong>
          <span>{candidate.endpoint.host}:{candidate.endpoint.port} · {candidate.devices.length} {candidate.devices.length === 1 ? 'device' : 'devices'}</span>
        </div>
        <Badge size="small" tone={presentation.tone}>{presentation.label}</Badge>
      </div>
      {candidate.devices.length > 0 ? (
        <div className="rig-discovery-candidate__devices">
          {visibleDevices.map((device, index) => (
            <span key={`${device.kind}-${device.name}-${index}`}>{device.name}</span>
          ))}
          {remainingDevices > 0 ? <span>+{remainingDevices} more</span> : null}
        </div>
      ) : null}
      {presentation.detail ? <p>{presentation.detail}</p> : null}
      {candidate.disposition.state === 'new' ? (
        <span className="rig-discovery-candidate__selection">{selected ? 'Selected' : 'Select'}</span>
      ) : null}
    </>
  )

  if (candidate.disposition.state !== 'new') {
    return <article className="rig-discovery-candidate">{content}</article>
  }

  return (
    <button
      aria-pressed={selected}
      className="rig-discovery-candidate"
      data-selected={selected}
      onClick={onSelect}
      type="button"
    >
      {content}
    </button>
  )
}

function EmptyDiscoveryResult({ failures }: { failures: ReadonlyArray<DiscoveryFailureView> }) {
  const scanFailed = failures.some((failure) => failure.reason === 'scan-failed')

  return (
    <div className="rig-discovery-message" data-tone={scanFailed ? 'danger' : 'neutral'}>
      <strong>{scanFailed ? 'Network scan could not start' : 'No Alpaca servers found'}</strong>
      <p>
        {scanFailed
          ? 'Vela could not use this computer’s network interfaces. You can try again without changing any hardware.'
          : 'Confirm the Alpaca server is running and that this computer is on the same network, then scan again.'}
      </p>
    </div>
  )
}

function DiscoveryFailures({ failures }: { failures: ReadonlyArray<DiscoveryFailureView> }) {
  if (failures.length === 0) return null

  return (
    <section aria-label="Discovery warnings" className="rig-discovery-failures">
      <strong>{failures.length === 1 ? 'One server could not be inspected' : `${failures.length} servers could not be inspected`}</strong>
      <ul>
        {failures.map((failure, index) => (
          <li key={`${failure.endpoint?.host ?? failure.reason}-${failure.endpoint?.port ?? index}`}>
            {failure.endpoint ? `${failure.endpoint.host}:${failure.endpoint.port} · ` : ''}
            {failureReason(failure.reason)}
          </li>
        ))}
      </ul>
    </section>
  )
}

function candidateDisposition(candidate: DiscoveryCandidateView) {
  switch (candidate.disposition.state) {
    case 'new':
      return { label: 'Eligible', tone: 'positive' as const }
    case 'ineligible':
      return {
        label: 'Unavailable',
        tone: 'warning' as const,
        detail: 'This server did not provide a stable device ID, so Vela cannot add it safely.',
      }
    case 'already-added':
      return { label: 'Already added', tone: 'neutral' as const }
    case 'conflict':
      return {
        label: 'Needs attention',
        tone: 'danger' as const,
        detail: 'This server conflicts with an existing rig and cannot be selected.',
      }
  }
}

function failureReason(reason: DiscoveryFailureView['reason']) {
  switch (reason) {
    case 'scan-failed':
      return 'Network scan could not start.'
    case 'unreachable':
      return 'The server did not respond.'
    case 'invalid-response':
      return 'The server returned information Vela could not read.'
    case 'protocol-error':
      return 'The server reported an Alpaca error.'
  }
}
