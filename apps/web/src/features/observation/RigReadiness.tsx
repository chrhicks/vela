import type { ConnectRigDevicesResult } from '@vela/model/web'
import { Button } from '@vela/ui'
import { useEffect, useRef } from 'react'
import { readinessPresentation } from './presentation'
import type { useObservation } from './use-observation'

export function RigReadiness({
  observation,
  startActionId,
}: {
  observation: ReturnType<typeof useObservation>
  startActionId: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const checkingFromHere = useRef(false)
  const { view, result, connecting, refreshing, interrupted, commandUnconfirmed, completedCommands } = observation

  const visible = !view || connecting || view.connectionPreparation.state !== 'complete' ||
    interrupted || commandUnconfirmed || !!result

  useEffect(() => {
    if (completedCommands > 0) heading.current?.focus()
  }, [completedCommands])

  useEffect(() => {
    if (!checkingFromHere.current || refreshing) return
    checkingFromHere.current = false

    // An explicit successful check can remove readiness. Keep focus in the capture workflow.
    if (visible) heading.current?.focus()
    else {
      const startAction = document.getElementById(startActionId)

      if (startAction instanceof HTMLButtonElement && startAction.disabled)
        startAction.closest('form')?.focus()
      else startAction?.focus()
    }
  }, [refreshing, visible, startActionId])

  function checkState() {
    checkingFromHere.current = true
    void observation.refresh()
  }

  if (!visible) return null

  if (!view) return (
    <section className="preparation-readiness" aria-label="Rig readiness">
      <div role="status">
        <h3 ref={heading} tabIndex={-1}>
          {observation.error === 'not-found'
            ? 'Rig not found'
            : observation.error ? 'Could not load this Rig' : 'Checking Rig readiness…'}
        </h3>
      </div>
      {observation.error && (
        <Button type="button" disabled={refreshing} onClick={checkState}>
          {refreshing ? 'Checking state…' : 'Check state'}
        </Button>
      )}
    </section>
  )

  const busy = connecting || (!interrupted && view.connectionPreparation.state === 'in-progress')
  const presentation = readinessPresentation(view, connecting, interrupted)
  const uncertain = commandUnconfirmed || result?.outcome === 'uncertain'
  const title = uncertain && !busy ? 'Connection outcome unknown' : presentation.title
  const { rig } = view

  return (
    <section className="preparation-readiness" aria-label="Rig readiness">
      <div role="status" aria-live="polite" aria-atomic="true">
        <h3 ref={heading} tabIndex={-1}>{title}</h3>
        <p>
          {uncertain && !busy
            ? 'Check current Rig state before trying another connection. Vela has not repeated the command.'
            : presentation.description}
        </p>
      </div>
      {result?.outcome === 'unavailable' && <ConnectionResult result={result} />}
      {(result?.outcome === 'partial' || result?.outcome === 'failed') && (
        <p role="status">
          {'failed' in result
            ? `${result.failed.name}: ${connectionFailure[result.failed.reason]}.`
            : `Connection stopped after ${result.stoppedAfter.name}; its connection was confirmed by a later check.`}
          {' '}{result.notAttempted.length > 0
            ? `${result.notAttempted.length} devices were not attempted.`
            : 'No other devices remain unattempted.'}
        </p>
      )}
      {commandUnconfirmed && (
        <p>
          The command response could not be confirmed. A fresh state check does not prove how
          that command ended.
        </p>
      )}
      {interrupted && uncertain && (
        <p>Current state is also unavailable. The values shown are last known.</p>
      )}
      <div className="preparation-readiness__actions">
        {busy ? (
          <Button type="button" disabled aria-busy="true">Connecting devices…</Button>
        ) : observation.canConnect ? (
          <Button type="button" onClick={() => void observation.connect()}>
            {result?.outcome === 'partial' || result?.outcome === 'failed'
              ? 'Try remaining devices'
              : 'Connect devices'}
          </Button>
        ) : null}
        <Button type="button" disabled={connecting || refreshing} onClick={checkState}>
          {refreshing ? 'Checking state…' : 'Check state'}
        </Button>
      </div>
      <details className="preparation-readiness__details">
        <summary>Device details{result ? ' & connection result' : ''}</summary>
        {result && <ConnectionResult result={result} />}
        <dl>
          <div>
            <dt>Rig</dt>
            <dd>{interrupted || busy ? 'Last known state' : rig.state === 'offline' ? 'Offline' : 'Reachable'}</dd>
          </div>
          <div>
            <dt>Device connections</dt>
            <dd>{busy ? 'Status updating' : `${rig.connections.connected} confirmed connected`}</dd>
          </div>
          <div>
            <dt>Other device states</dt>
            <dd>
              {busy
                ? 'Status updating'
                : `${rig.connections.disconnected} disconnected · ${rig.connections.unavailable} unavailable`}
            </dd>
          </div>
        </dl>
        <p>
          {interrupted || busy ? 'Last received' : 'Checked'}{' '}
          <time dateTime={rig.refreshedAt}>
            {new Date(rig.refreshedAt).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </time>
        </p>
        <p>{rig.endpoint.host}:{rig.endpoint.port}</p>
        <p>
          {busy
            ? 'Vela connects devices one at a time and stops if a result cannot be established.'
            : 'Checking the Rig only reads current state. It does not start an exposure.'}
        </p>
      </details>
    </section>
  )
}

export function ConnectionResult({ result }: { result: ConnectRigDevicesResult }) {
  if (result.outcome === 'unavailable')
    return (
      <p className="vela-observe-warning">
        Connection was unavailable:{' '}
        {
          {
            'identity-conflict': 'the Rig identity changed.',
            offline: 'the Rig was offline.',
            'device-state-unavailable': 'device state could not be confirmed.',
          }[result.reason]
        }
      </p>
    )

  if (result.outcome === 'complete')
    return (
      <p>
        Last connection attempt:{' '}
        {result.command === 'not-needed'
          ? 'no connection commands were needed.'
          : `${result.confirmedConnected.length} device connections confirmed.`}
      </p>
    )

  return (
    <section className="vela-observe-result" aria-label="Last connection attempt">
      <h4>Last connection attempt</h4>
      <dl>
        <div>
          <dt>Confirmed connected</dt>
          <dd>
            {result.confirmedConnected.map(device => device.name).join(' · ') ||
              'None confirmed by this attempt'}
          </dd>
        </div>
        {'failed' in result && (
          <div>
            <dt>Connection failed</dt>
            <dd>
              {result.failed.name} —{' '}
              {connectionFailure[result.failed.reason]}
            </dd>
          </div>
        )}
        {'uncertain' in result && (
          <div>
            <dt>Not confirmed</dt>
            <dd>{result.uncertain.name}</dd>
          </div>
        )}
        {'stoppedAfter' in result && (
          <div>
            <dt>Stopped after</dt>
            <dd>
              {result.stoppedAfter.name} — confirmed by a later state check; sequencing had already
              stopped.
            </dd>
          </div>
        )}
        <div>
          <dt>Not attempted</dt>
          <dd>{result.notAttempted.map(device => device.name).join(' · ') || 'None'}</dd>
        </div>
      </dl>
    </section>
  )
}

const connectionFailure = {
  rejected: 'connection rejected',
  'remained-disconnected': 'remained disconnected',
  'device-not-found': 'device not found',
  'connection-check-failed': 'connection check failed',
}
