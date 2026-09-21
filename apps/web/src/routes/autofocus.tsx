import type { AutofocusView } from '@vela/model/web'
import { Badge, Button, Input, Panel } from '@vela/ui'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { AutofocusCurve } from '../features/autofocus/AutofocusCurve'
import { autofocusActivity, useAutofocus } from '../features/autofocus/use-autofocus'
import { isTravelLimitError } from '../features/autofocus/validation'
import { previewAutofocusWindow } from '../features/autofocus/window'
import './autofocus.css'

export function Autofocus() {
  const { rigId = '' } = useParams()

  return <AutofocusPage key={rigId} rigId={rigId} />
}

function AutofocusPage({ rigId }: { rigId: string }) {
  const { view, offline, pending, error, start, stop } = useAutofocus(rigId)
  const [stepSize, setStepSize] = useState('50')
  const [returnedToSetup, setReturnedToSetup] = useState(false)

  const back = (
    <Link className="vela-rig-page__back" to={`/rigs/${encodeURIComponent(rigId)}/observe`}>
      ← Observe
    </Link>
  )

  useEffect(() => {
    if (view?.active) setReturnedToSetup(false)
  }, [view?.active])

  if (!view) return (
    <section className="vela-rig-page">
      {back}
      <h1>Autofocus</h1>
      <p role="status">{offline ? 'Autofocus state unavailable. Reconnecting…' : 'Loading autofocus…'}</p>
    </section>
  )

  const step = Math.max(1, Math.floor(Number(stepSize) || 50))
  const disabled = pending || offline
  const setup = !view.active && (view.phase === 'setup' || returnedToSetup)
  const busy = view.active
  const retrying = view.captureReadState === 'retrying'
  const latest = view.samples.at(-1)

  const lowest = view.samples.reduce<AutofocusView['samples'][number] | undefined>((best, sample) => {
    if (sample.hfrPixels === null) return best

    return !best || best.hfrPixels === null || sample.hfrPixels < best.hfrPixels ? sample : best
  }, undefined)

  const window = previewAutofocusWindow(view.currentPosition, step, view.offsetSteps, view.maxStep)
  const travelBlocked = setup && view.currentPosition != null && !window.fit
  const travelLimit = travelBlocked || (setup && isTravelLimitError(view.error))

  let notice

  if (travelLimit) {
    notice = {
      role: 'alert' as const,
      title: 'Walk would approach a travel limit',
      body: error || view.error || 'Vela stays at the current EAF position. It does not command 0 or MaxStep, and it will not start a window that cannot fit around start.',
    }
  } else if (!setup && view.restoredStart && view.phase === 'stopped') {
    notice = {
      role: 'status' as const,
      title: 'Start position restored',
      body: `The walk stopped before a fitted focus. The focuser is back at ${view.startPosition ?? 'the session start'}, the position where this session began.`,
    }
  } else if (view.phase === 'failed' && !view.restoredStart) {
    notice = {
      role: 'status' as const,
      title: 'Start position was not restored',
      body: error || view.error || 'The start position was not confirmed. Vela did not repeat the move.',
    }
  } else if (error || view.error || (!view.enabled && view.unavailableReason)) {
    notice = {
      role: 'status' as const,
      title: error && view.active
        ? 'Command outcome unknown'
        : error || (view.error && !isTravelLimitError(view.error)) ? 'Walk did not start' : 'Autofocus',
      body: error || view.error || view.unavailableReason,
    }
  } else if (retrying && !offline) {
    notice = {
      role: 'status' as const,
      title: 'Camera observation interrupted',
      body: 'The server is connected. Retrying reads for the same exposure; no new exposure or focus move will start while waiting. Samples on the curve are kept. You can stop and restore start while reads retry.',
    }
  } else {
    notice = null
  }

  const activity = offline ? 'Connection interrupted'
    : error ? 'Command outcome unknown'
      : pending ? 'Sending command…' : autofocusActivity(view, false)

  let badge

  if (offline) {
    badge = 'Disconnected'
  } else if (error) {
    badge = 'Confirmation needed'
  } else if (retrying) {
    badge = 'Awaiting camera'
  } else if (setup) {
    badge = view.error || travelBlocked ? 'Blocked' : 'Not started'
  } else if (view.phase === 'walking') {
    badge = 'Walking'
  } else if (view.phase === 'fitting') {
    badge = 'Fitting'
  } else if (view.phase === 'confirming') {
    badge = 'Confirming'
  } else if (view.phase === 'complete') {
    badge = 'Complete'
  } else if (view.phase === 'stopped') {
    badge = 'Restored'
  } else {
    badge = 'Failed'
  }

  return (
    <section className="vela-rig-page vela-autofocus" data-pending={pending || undefined}>
      {back}
      <header className="vela-af-heading">
        <div>
          <p>{view.rigName} · Rig preparation</p>
          <h1>Autofocus</h1>
        </div>
        <Badge
          tone={offline || error || retrying || view.phase === 'failed' || (!setup && view.phase === 'stopped') || (setup && travelBlocked)
            ? 'warning'
            : busy ? 'accent'
              : view.phase === 'complete' && !setup ? 'positive' : 'neutral'}
        >
          {badge}
        </Badge>
      </header>
      {notice && (
        <div className="vela-af-notice" role={notice.role}>
          <strong>{notice.title}</strong>
          <p>{notice.body}</p>
        </div>
      )}
      {setup ? (
        <div className="vela-af-setup">
          <Panel>
            <h2>Focus from where you are</h2>
            <p>Vela will jump a little outward from the current EAF position, walk back through focus, and plot star size at each stop. Cancel returns here. Position 0 is a mechanical stop, not a home, and not backlash compensation off.</p>
            <dl className="vela-af-facts">
              <div>
                <dt>Current position</dt>
                <dd>{view.currentPosition ?? '—'}</dd>
              </div>
              <div>
                <dt>MaxStep</dt>
                <dd>{view.maxStep ?? '—'}</dd>
              </div>
              <div>
                <dt>Camera</dt>
                <dd>{view.cameraName ?? 'Not selected'}</dd>
              </div>
              <div>
                <dt>Focuser</dt>
                <dd>{view.focuserName ?? 'Not found'}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>
                  {view.currentPosition == null
                    ? 'Around the current position'
                    : window.fit ? `${window.low} → ${window.high}` : 'Does not fit around start'}
                </dd>
              </div>
            </dl>
            <Input
              label="Step size"
              type="number"
              min={1}
              max={2000}
              value={stepSize}
              onChange={event => setStepSize(event.target.value)}
              message="Steps between shorts. Large enough that HFR changes; small enough to stay inside the window around start."
            />
          </Panel>
          <div className="vela-af-next">
            <h3>Before you start</h3>
            <p>Each point on the graph is one short exposure. You will see start, current position, and the fitted minimum once the hyperbola exists.</p>
            <p>The walk stays inside a window around the current position. Vela will not command 0 or MaxStep.</p>
            <Button
              size="large"
              tone="accent"
              disabled={disabled || !view.enabled || travelBlocked}
              onClick={() => void start(step, view.exposureSeconds || 2)}
            >
              {travelBlocked ? 'Window does not fit' : 'Start autofocus'}
            </Button>
          </div>
        </div>
      ) : (
        <Walk
          view={view}
          activity={activity}
          latest={latest}
          lowest={lowest}
          interrupted={offline || !!error || pending || retrying}
          disabled={disabled}
          busy={busy}
          onStop={() => void stop()}
          onBackToSetup={() => setReturnedToSetup(true)}
        />
      )}
    </section>
  )
}

function Walk({
  view,
  activity,
  latest,
  lowest,
  interrupted,
  disabled,
  busy,
  onStop,
  onBackToSetup,
}: {
  view: AutofocusView
  activity: string
  latest: AutofocusView['samples'][number] | undefined
  lowest: AutofocusView['samples'][number] | undefined
  interrupted: boolean
  disabled: boolean
  busy: boolean
  onStop: () => void
  onBackToSetup: () => void
}) {
  const planned = view.offsetSteps * 2 + 1
  const expected = Math.max(planned, view.samples.length)

  return (
    <div className="vela-af-layout">
      <Panel className="vela-af-chart-panel">
        <div className="vela-af-chart-heading">
          <span>Star HFR as the focuser walks</span>
          <span>Window around start · not a home to 0</span>
        </div>
        {view.startPosition !== null && (
          <AutofocusCurve
            start={view.startPosition}
            current={interrupted ? null : view.currentPosition}
            samples={view.samples}
            fit={view.fit}
            stepSize={view.stepSize}
            offsetSteps={view.offsetSteps}
          />
        )}
        <div className="vela-af-legend">
          <span>
            <i data-kind="start" /> Start
          </span>
          <span>
            <i data-kind="sample" /> Sample
          </span>
          <span>
            <i data-kind="curve" /> Hyperbola
          </span>
          <span>
            <i data-kind="fit" /> Fitted minimum
          </span>
        </div>
      </Panel>
      <Panel className="vela-af-readout">
        <dl>
          <div>
            <dt>Start</dt>
            <dd>{view.startPosition ?? '—'}</dd>
          </div>
          <div>
            <dt>Current</dt>
            <dd>{view.currentPosition ?? '—'}</dd>
          </div>
          <div>
            <dt>Latest sample</dt>
            <dd>
              {latest
                ? latest.hfrPixels === null
                  ? `${latest.position} · no stars`
                  : `${latest.position} · ${latest.hfrPixels.toFixed(2)} px`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Fitted focus</dt>
            <dd>{view.fit ? view.fit.position : '—'}</dd>
          </div>
          <div>
            <dt>Min-sample</dt>
            <dd>{lowest ? lowest.position : '—'}</dd>
          </div>
        </dl>
        <div className="vela-af-activity">
          <div className="vela-af-activity__line" role="status">
            {busy && !interrupted ? <span className="vela-af-activity__spinner" aria-hidden="true" /> : null}
            <strong>{activity}</strong>
          </div>
          <p>
            {view.samples.length
              ? `${view.samples.length} of ${expected} shorts on the curve.`
              : 'No samples yet. The graph fills as each short exposure lands.'}
          </p>
          {latest && (
            <p>
              {'Last sample '}
              <time dateTime={latest.capturedAt}>{new Date(latest.capturedAt).toLocaleTimeString()}</time>
            </p>
          )}
        </div>
      </Panel>
      <div className="vela-af-actions">
        <p>
          {view.phase === 'complete'
            ? 'The fitted minimum is an integer step inside the sampled window. The lowest sampled HFR is shown only for comparison.'
            : view.restoredStart
              ? 'Start a new walk from the current position when you are ready.'
              : view.phase === 'failed'
                ? 'The start position was not confirmed. Vela did not repeat the move.'
                : 'Points appear as each short lands. Stop restores the start position; Vela will not keep walking toward a limit.'}
        </p>
        {busy ? (
          <Button size="large" disabled={disabled} onClick={onStop}>Stop and restore start</Button>
        ) : (
          <Button size="large" tone="accent" disabled={disabled || !view.enabled} onClick={onBackToSetup}>
            {view.phase === 'complete' ? 'Focus again' : 'Back to setup'}
          </Button>
        )}
      </div>
    </div>
  )
}
