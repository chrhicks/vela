import type { ConnectRigDevicesResult } from '@vela/model/web'
import { Button, Panel } from '@vela/ui'
import { useEffect, useRef } from 'react'
import { readinessPresentation } from './presentation'
import type { useObservation } from './use-observation'
import { ConnectionMark } from './ObservationMark'

export function RigReadiness({ observation }: { observation: ReturnType<typeof useObservation> }) {
  const heading = useRef<HTMLHeadingElement>(null)
  const readiness = useRef<HTMLDetailsElement>(null)
  const readinessSummary = useRef<HTMLElement>(null)
  const { view, result, connecting, refreshing, interrupted, commandUnconfirmed, completedCommands } = observation
  useEffect(() => {
    if (completedCommands > 0) {
      const resultTarget = readiness.current?.open ? heading.current : readinessSummary.current
      resultTarget?.focus()
    }
  }, [completedCommands])

  if (!view) return null
  const busy = connecting || (!interrupted && view.connectionPreparation.state === 'in-progress')
  const presentation = readinessPresentation(view, connecting, interrupted)
  const uncertain = commandUnconfirmed || result?.outcome === 'uncertain'
  const title = uncertain && !busy ? 'The connection result is uncertain' : presentation.title
  const { rig } = view

  return (
    <details
      ref={readiness}
      className="capture-page__rig vela-capture-rig"
      open={
        busy || uncertain || interrupted || view.connectionPreparation.state !== 'complete'
          ? true
          : undefined
      }
    >
      <summary ref={readinessSummary}>
        <span>
          <i data-offline={interrupted || undefined} />
          {title}
        </span>
        <span>Device details</span>
      </summary>
      <div className="vela-observe-section-heading">
        <div>
          <small>Preparation</small>
          <h2>Rig readiness</h2>
        </div>
        <span>
          {interrupted || busy ? 'Last received' : 'Checked'}{' '}
          <time dateTime={rig.refreshedAt}>
            {new Date(rig.refreshedAt).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </time>
        </span>
      </div>
      <div className="vela-observe-grid">
        <Panel
          className="vela-observe-readiness"
          elevation="raised"
          data-tone={uncertain ? 'warning' : presentation.tone}
        >
          <div className="vela-observe-summary">
            <span aria-hidden="true" className="vela-observe-mark">
              {uncertain || interrupted ? (
                <span>!</span>
              ) : (
                <ConnectionMark busy={busy} tone={presentation.tone} />
              )}
            </span>
            <div role="status" aria-live="polite" aria-atomic="true">
              <h3 ref={heading} tabIndex={-1}>
                {title}
              </h3>
              <p>
                {uncertain && !busy
                  ? 'Check current Rig state before trying another connection. Vela has not repeated the command.'
                  : presentation.description}
              </p>
            </div>
          </div>
          {commandUnconfirmed && (
            <p className="vela-observe-warning">
              The command response could not be confirmed. A fresh state check does not prove how
              that command ended.
            </p>
          )}
          {interrupted && uncertain && (
            <p>Current state is also unavailable. The values shown are last known.</p>
          )}
          {result && <ConnectionResult result={result} />}
          <div className="vela-observe-actions">
            {busy ? (
              <Button disabled aria-busy="true" tone="accent">
                Connecting devices…
              </Button>
            ) : observation.canConnect ? (
              <Button onClick={() => void observation.connect()} tone="accent">
                {result?.outcome === 'partial' || result?.outcome === 'failed'
                  ? 'Try remaining devices'
                  : 'Connect devices'}
              </Button>
            ) : null}
            <Button
              disabled={connecting || refreshing}
              onClick={() => void observation.refresh()}
            >
              {refreshing ? 'Checking Rig…' : 'Check Rig again'}
            </Button>
          </div>
          <p className="vela-observe-note">
            {busy
              ? 'Vela connects devices one at a time and stops if a result cannot be established.'
              : 'Connection is an explicit preparation action. Checking the Rig only reads current state.'}
          </p>
        </Panel>
        <Panel className="vela-observe-facts" title="What Vela can confirm" elevation="flat">
          <dl>
            <div>
              <dt>Rig</dt>
              <dd>
                {interrupted || busy
                  ? 'Last known state'
                  : rig.state === 'offline'
                    ? 'Offline'
                    : 'Reachable'}
              </dd>
            </div>
            <div>
              <dt>Device connections</dt>
              <dd>
                {busy ? 'Status updating' : `${rig.connections.connected} confirmed connected`}
              </dd>
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
            {rig.endpoint.host}:{rig.endpoint.port}
          </p>
          <p>Opening this workspace does not start an exposure or save an observation.</p>
        </Panel>
      </div>
    </details>
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
              {
                {
                  rejected: 'connection rejected',
                  'remained-disconnected': 'remained disconnected',
                  'device-not-found': 'device not found',
                  'connection-check-failed': 'connection check failed',
                }[result.failed.reason]
              }
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
