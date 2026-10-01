import type { AutofocusView } from '@vela/model/web'
import { Button, Input } from '@vela/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { AutofocusCurve } from '../features/autofocus/AutofocusCurve'
import {
  autofocusActivity,
  useAutofocus,
} from '../features/autofocus/use-autofocus'
import { isTravelLimitError } from '../features/autofocus/validation'
import { previewAutofocusWindow } from '../features/autofocus/window'
import './autofocus.css'

const number = (value: number | null) =>
  value === null ? '—' : value.toLocaleString()

function sampleTime(sample: AutofocusView['samples'][number] | undefined) {
  return sample
    ? new Date(sample.capturedAt).toLocaleTimeString('en-GB')
    : 'unavailable'
}

interface Outcome {
  eyebrow: string
  title: string
  body: string
  fact: string
  footer: string
  tone: 'warning' | 'danger' | 'active'
}

export function Autofocus() {
  const { rigId = '' } = useParams()

  return <AutofocusPage key={rigId} rigId={rigId} />
}

function AutofocusPage({ rigId }: { rigId: string }) {
  const { view, offline, pending, error, stopUnconfirmed, start, stop } =
    useAutofocus(rigId)

  const [stepSize, setStepSize] = useState('50')
  const [returnedToSetup, setReturnedToSetup] = useState(false)

  useEffect(() => {
    if (view?.active) setReturnedToSetup(false)
  }, [view?.active])

  const heading = (
    <header className="vela-af-heading">
      <Link to={`/rigs/${encodeURIComponent(rigId)}/observe/capture`}>
        ← Tonight
      </Link>
      <h1>Autofocus</h1>
      {view && <span>{view.rigName} · Rig preparation</span>}
    </header>
  )

  if (!view)
    return (
      <section className="vela-autofocus">
        <div className="vela-af-main">
          {heading}
          <p role="status">
            {offline
              ? 'Autofocus state unavailable. Reconnecting…'
              : 'Loading autofocus…'}
          </p>
        </div>
      </section>
    )

  const step = Math.max(1, Math.floor(Number(stepSize) || 50))
  const disabled = pending || offline || stopUnconfirmed
  const setup = !view.active && (view.phase === 'setup' || returnedToSetup)

  const window = previewAutofocusWindow(
    view.currentPosition,
    step,
    view.offsetSteps,
    view.maxStep,
  )

  const travelBlocked = setup && view.currentPosition !== null && !window.fit
  const latest = view.samples.at(-1)

  const lowest = view.samples.reduce<
    AutofocusView['samples'][number] | undefined
  >((best, sample) => {
    if (sample.hfrPixels === null) return best

    return !best || best.hfrPixels === null || sample.hfrPixels < best.hfrPixels
      ? sample
      : best
  }, undefined)

  const outcome = autofocusOutcome(view, {
    offline,
    error,
    setup,
    travelBlocked,
    step,
    latest,
    lowest,
  })

  const low =
    view.startPosition === null
      ? null
      : view.startPosition - view.offsetSteps * view.stepSize

  const high =
    view.startPosition === null
      ? null
      : view.startPosition + view.offsetSteps * view.stepSize

  const action = (
    <Button
      tone={outcome ? 'neutral' : 'accent'}
      disabled={
        disabled ||
        view.activity === 'stopping' ||
        view.activity === 'restoring' ||
        (!view.active && !view.enabled)
      }
      onClick={() => (view.active ? void stop() : setReturnedToSetup(true))}
    >
      {view.active
        ? 'Stop and restore start'
        : view.phase === 'complete'
          ? 'Focus again'
          : 'Back to setup'}
    </Button>
  )

  return (
    <section className="vela-autofocus" data-pending={pending || undefined}>
      <div className="vela-af-main">
        {heading}
        {setup ? (
          <div className="vela-af-setup">
            <section className="vela-af-chart-panel">
              <h2>Focus from where you are</h2>
              <p className="vela-af-intro">
                Vela samples star size in a small window around the current
                position, then fits the curve to find focus.
              </p>
              <PlannedWindow
                position={view.currentPosition}
                step={step}
                offsets={view.offsetSteps}
              />
              <dl className="vela-af-window-facts">
                <div>
                  <dt>Planned window</dt>
                  <dd>
                    {window.fit
                      ? `${number(window.low)} – ${number(window.high)}`
                      : 'Does not fit around start'}
                  </dd>
                </div>
                <div>
                  <dt>Short exposure</dt>
                  <dd>{view.exposureSeconds || 2} seconds per sample</dd>
                </div>
                <div>
                  <dt>Samples before fitting</dt>
                  <dd>{view.offsetSteps * 2 + 1} planned</dd>
                </div>
              </dl>
              <p className="vela-af-panel-note">
                Position 0 and MaxStep are mechanical limits. Vela will not
                command either limit.
              </p>
            </section>
            <aside className="vela-af-side">
              {outcome ? (
                <OutcomeCard
                  outcome={outcome}
                  action={
                    travelBlocked ? (
                      <Button disabled>Window does not fit</Button>
                    ) : undefined
                  }
                />
              ) : (
                <div className="vela-af-status vela-af-ready" role="status">
                  <strong>
                    <i className="vela-af-status-dot" aria-hidden="true" />
                    {pending
                      ? 'Sending command…'
                      : view.enabled
                        ? 'Ready to start'
                        : 'Autofocus unavailable'}
                  </strong>
                  <p>
                    {view.enabled
                      ? 'Camera and focuser are available.'
                      : (view.unavailableReason ??
                        'Check the camera and focuser before starting.')}
                  </p>
                </div>
              )}
              <dl className="vela-af-facts">
                <div>
                  <dt>Imaging camera</dt>
                  <dd>{view.cameraName ?? 'Not selected'}</dd>
                </div>
                <div>
                  <dt>Focuser</dt>
                  <dd>{view.focuserName ?? 'Not found'}</dd>
                </div>
                <div>
                  <dt>Maximum position · MaxStep</dt>
                  <dd>{number(view.maxStep)}</dd>
                </div>
              </dl>
              <div className="vela-af-step">
                <Input
                  label="Step size"
                  type="number"
                  min={1}
                  max={2000}
                  value={stepSize}
                  onChange={event => setStepSize(event.target.value)}
                  message="Distance between samples. Keep the window inside the focuser’s travel."
                />
                <span className="vela-af-step-suffix" aria-hidden="true">
                  steps
                </span>
              </div>
              {!travelBlocked && (
                <>
                  <Button
                    tone="accent"
                    disabled={disabled || !view.enabled || travelBlocked}
                    onClick={() => void start(step, view.exposureSeconds || 2)}
                  >
                    Start autofocus
                  </Button>
                  <p className="vela-af-support">
                    Stop during the walk requests a return to the starting
                    position.
                  </p>
                </>
              )}
            </aside>
          </div>
        ) : (
          <div className="vela-af-layout">
            <section className="vela-af-chart-panel">
              <h2>Star size through the walk</h2>
              <p className="vela-af-support vela-af-chart-intro">
                Each point is one completed exposure. Lower HFR means smaller
                measured stars.
              </p>
              <p className="vela-af-mobile-label">Star HFR · px</p>
              {view.startPosition !== null && (
                <AutofocusCurve
                  start={view.startPosition}
                  samples={view.samples}
                  fit={view.fit}
                  stepSize={view.stepSize}
                  offsetSteps={view.offsetSteps}
                />
              )}
              <p className="vela-af-mobile-label">
                Focuser position ·{' '}
                {view.fit ? 'Fitted curve' : 'No fitted curve yet'}
              </p>
              <div className="vela-af-legend">
                <span>
                  <i className="vela-af-legend-sample" aria-hidden="true" />
                  Measured sample
                </span>
                <span>
                  <i className="vela-af-legend-start" aria-hidden="true" />
                  Start position
                </span>
                <span>
                  <i className="vela-af-legend-lowest" aria-hidden="true" />
                  Lowest measured sample
                </span>
              </div>
              <p className="vela-af-panel-note">
                {view.fit
                  ? 'Fitted focus and the lowest measured sample are separate results.'
                  : 'No fitted curve yet. The fitted minimum appears only after the server completes the fit.'}
              </p>
              {view.samples.some(sample => sample.hfrPixels === null) && (
                <p className="vela-af-support">
                  Hollow markers show positions with no measurable stars, not an
                  HFR value.
                </p>
              )}
            </section>
            {outcome ? (
              <OutcomeCard outcome={outcome} action={action} />
            ) : (
              <ActiveStatus view={view} pending={pending} action={action} />
            )}
            <dl className="vela-af-readout">
              <div>
                <dt>Start position</dt>
                <dd>{number(view.startPosition)}</dd>
              </div>
              <div>
                <dt>Latest sample</dt>
                <dd>
                  {latest
                    ? `${number(latest.position)} · ${latest.hfrPixels === null ? 'no stars' : `${latest.hfrPixels.toFixed(2)} px`}`
                    : '—'}
                </dd>
              </div>
              <div className="vela-af-desktop-fact">
                <dt>Fitted focus</dt>
                <dd>{number(view.fit?.position ?? null)}</dd>
              </div>
              <div className="vela-af-desktop-fact">
                <dt>Lowest measured sample</dt>
                <dd>{number(lowest?.position ?? null)}</dd>
              </div>
              <div className="vela-af-mobile-fact">
                <dt>Last sample</dt>
                <dd>
                  {latest ? (
                    <time dateTime={latest.capturedAt}>
                      {sampleTime(latest)}
                    </time>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>
            {!outcome && (
              <div className="vela-af-actions">
                <p className="vela-af-desktop-help">
                  Last sample{' '}
                  {latest ? (
                    <time dateTime={latest.capturedAt}>
                      {sampleTime(latest)}
                    </time>
                  ) : (
                    'unavailable'
                  )}
                  . Stop requests a return to {number(view.startPosition)}; the
                  result is shown when confirmed.
                </p>
                <p className="vela-af-mobile-help">
                  Stop ends the walk and requests a return to the start
                  position.
                </p>
                <div className="vela-af-mobile-action">{action}</div>
              </div>
            )}
          </div>
        )}
        <footer className="vela-af-footer">
          <span>
            {setup
              ? 'Window is checked before movement.'
              : `Step ${view.stepSize} · Window ${number(low)}–${number(high)}`}
          </span>
          {setup && (
            <details>
              <summary>About the focuser limits</summary>
              <p>
                Position 0 is a mechanical stop, not a home, and not backlash
                compensation off. This walk does not change backlash
                compensation.
              </p>
            </details>
          )}
        </footer>
      </div>
    </section>
  )
}

function ActiveStatus({
  view,
  pending,
  action,
}: {
  view: AutofocusView
  pending: boolean
  action: ReactNode
}) {
  let badge = 'Walking'

  if (pending) badge = 'Sending command…'
  else if (view.activity === 'restoring') badge = 'Restoring start…'
  else if (view.activity === 'stopping') badge = 'Stopping…'
  else if (view.phase === 'fitting') badge = 'Fitting'
  else if (view.phase === 'confirming') badge = 'Confirming'

  const activity = pending ? 'Sending command…' : autofocusActivity(view, false)

  return (
    <div className="vela-af-status" role="status">
      <div className="vela-af-status-line">
        <strong>
          {!pending && view.active && (
            <i className="vela-af-status-dot" aria-hidden="true" />
          )}
          {badge}
        </strong>
        <span>
          {view.samples.length} of{' '}
          {Math.max(view.offsetSteps * 2 + 1, view.samples.length)} samples
        </span>
      </div>
      <p className="vela-af-desktop-activity">
        {view.activity === 'exposing' && !pending
          ? 'Exposing at current position'
          : activity}
      </p>
      <p className="vela-af-mobile-activity">
        {view.activity === 'exposing' && !pending
          ? `Exposing at ${number(view.currentPosition)}…`
          : activity}
      </p>
      <strong className="vela-af-current">
        {number(view.currentPosition)}
      </strong>
      <p className="vela-af-support vela-af-exposure">
        {view.activity === 'exposing' ? (
          <>
            {view.exposureSeconds}-second exposure
            <span> · Waiting for the next sample</span>
          </>
        ) : (
          'Waiting for confirmation'
        )}
      </p>
      <div className="vela-af-desktop-action">{action}</div>
    </div>
  )
}

function OutcomeCard({
  outcome,
  action,
}: {
  outcome: Outcome
  action?: ReactNode
}) {
  return (
    <section
      className="vela-af-outcome vela-af-notice"
      data-tone={outcome.tone}
      role={outcome.tone === 'danger' ? 'alert' : 'status'}
    >
      <p className="vela-af-outcome-eyebrow">{outcome.eyebrow}</p>
      <h2>{outcome.title}</h2>
      <p className="vela-af-outcome-body">{outcome.body}</p>
      <p className="vela-af-outcome-fact">{outcome.fact}</p>
      {action}
      <p className="vela-af-outcome-footer">{outcome.footer}</p>
    </section>
  )
}

function autofocusOutcome(
  view: AutofocusView,
  state: {
    offline: boolean
    error: string | null
    setup: boolean
    travelBlocked: boolean
    step: number
    latest: AutofocusView['samples'][number] | undefined
    lowest: AutofocusView['samples'][number] | undefined
  },
): Outcome | null {
  const { offline, error, setup, travelBlocked, step, latest, lowest } = state

  if (offline)
    return {
      eyebrow: 'Browser connection lost',
      title: 'Autofocus state is unknown',
      body: 'The last received curve and readings are retained. Vela is reconnecting; no live activity or successful stop is confirmed.',
      fact: `Last sample ${sampleTime(latest)} · Readings interrupted`,
      footer: 'Unavailable until the server can be reached',
      tone: 'warning',
    }

  if (error)
    return {
      eyebrow: 'Confirmation needed',
      title: 'Command outcome unknown',
      body: error,
      fact: `Last sample ${sampleTime(latest)} · ${view.samples.length} measured samples`,
      footer: 'Waiting for current server state; the command is not repeated.',
      tone: 'warning',
    }

  if (setup && (travelBlocked || isTravelLimitError(view.error)))
    return {
      eyebrow: 'Setup · Travel limit',
      title: 'Window does not fit',
      body:
        view.error ??
        `At position ${number(view.currentPosition)}, step size ${step} would put this window across a mechanical limit. Adjust the step size before starting.`,
      fact: 'Position 0 and MaxStep are mechanical limits',
      footer: 'No movement commanded · Stay in setup',
      tone: 'warning',
    }

  if (
    view.phase === 'failed' ||
    (view.phase === 'stopped' && !view.restoredStart)
  )
    return {
      eyebrow: view.restoredStart ? 'Walk failed' : 'Restoration failed',
      title: view.restoredStart
        ? 'Walk failed · start restored'
        : 'Start position not confirmed',
      body:
        view.error ??
        (view.restoredStart
          ? `The focuser returned to ${number(view.startPosition)}, but the walk did not complete.`
          : `The run failed and return to ${number(view.startPosition)} was not confirmed. Vela did not repeat the move. The measured curve is retained.`),
      fact: view.restoredStart
        ? `Confirmed return to ${number(view.startPosition)}`
        : 'Current position is the last received reading',
      footer: 'Action availability follows the server state',
      tone: 'danger',
    }

  if (view.captureReadState === 'retrying')
    return {
      eyebrow: 'Camera read retry',
      title: 'Waiting for the same exposure',
      body: 'Samples and the last sample time stay visible. The focuser does not advance while camera reads retry.',
      fact: `Last sample ${sampleTime(latest)} · ${view.samples.length} measured samples`,
      footer: 'Server connected · Stop remains available',
      tone: 'warning',
    }

  if (!setup && view.phase === 'complete')
    return {
      eyebrow: 'Confirmed completion',
      title: view.fit ? 'Fitted focus is ready' : 'Autofocus completed',
      body: `Focuser position ${number(view.currentPosition)} is confirmed. The fitted minimum and lowest measured sample remain distinct.`,
      fact: `Fitted focus ${number(view.fit?.position ?? null)} · Lowest sample ${number(lowest?.position ?? null)}`,
      footer: 'Return to setup before another walk',
      tone: 'active',
    }

  if (!setup && view.phase === 'stopped' && view.restoredStart)
    return {
      eyebrow: 'Confirmed stop',
      title: 'Start position restored',
      body: `The walk stopped before a fitted focus. The focuser is back at ${number(view.startPosition)}, where this session began.`,
      fact: `Stopped · Current position ${number(view.currentPosition)}`,
      footer: 'Retain the curve and completed samples',
      tone: 'active',
    }

  if (view.error || (!view.enabled && view.unavailableReason))
    return {
      eyebrow: 'Autofocus unavailable',
      title: view.error ? 'Walk did not start' : 'Autofocus unavailable',
      body: view.error ?? view.unavailableReason!,
      fact: 'No new movement is requested by this view.',
      footer: 'Check the camera and focuser before starting.',
      tone: 'warning',
    }

  return null
}

function PlannedWindow({
  position,
  step,
  offsets,
}: {
  position: number | null
  step: number
  offsets: number
}) {
  if (position === null)
    return (
      <p className="vela-af-window-unavailable">
        The current focuser position is unavailable.
      </p>
    )
  const low = position - offsets * step
  const high = position + offsets * step

  return (
    <>
      <svg
        className="vela-af-window vela-af-window--desktop"
        viewBox="0 0 838 210"
        role="img"
        aria-label="Planned focuser window around the current position"
      >
        <rect x="56" y="69" width="726" height="40" rx="4" />
        <path className="vela-af-window-axis" d="M56 89H782" />
        <path
          className="vela-af-window-direction"
          d="M782 42H56M56 42l8-5M56 42l8 5"
        />
        {Array.from({ length: offsets * 2 + 1 }, (_, index) => (
          <path
            className="vela-af-window-axis"
            key={index}
            d={`M${56 + (index * 726) / (offsets * 2)} 79v20`}
          />
        ))}
        <path className="vela-af-window-direction" d="M419 60v62" />
        <circle cx="419" cy="89" r="6" />
        <text x="419" y="22" textAnchor="middle">
          Samples walk inward after the outward start
        </text>
        <text
          className="vela-af-window-value"
          x="56"
          y="147"
          textAnchor="middle"
        >
          {number(low)}
        </text>
        <text
          className="vela-af-window-value"
          x="419"
          y="147"
          textAnchor="middle"
        >
          {number(position)}
        </text>
        <text
          className="vela-af-window-value"
          x="782"
          y="147"
          textAnchor="middle"
        >
          {number(high)}
        </text>
        <text x="419" y="174" textAnchor="middle">
          Current position · session start
        </text>
        <text x="782" y="174" textAnchor="middle">
          First sample
        </text>
      </svg>
      <svg
        className="vela-af-window vela-af-window--compact"
        viewBox="0 0 320 120"
        role="img"
        aria-label={`Planned window ${number(low)} to ${number(high)}. Current position and session start ${number(position)}. First sample ${number(high)}, then samples walk inward.`}
      >
        <text x="160" y="14" textAnchor="middle">
          Samples walk inward
        </text>
        <path
          className="vela-af-window-direction"
          d="M288 28H32M32 28l7-4M32 28l7 4"
        />
        <rect x="32" y="42" width="256" height="28" rx="4" />
        <path className="vela-af-window-axis" d="M32 56H288" />
        {Array.from({ length: offsets * 2 + 1 }, (_, index) => (
          <path
            className="vela-af-window-axis"
            key={index}
            d={`M${32 + (index * 256) / (offsets * 2)} 49v14`}
          />
        ))}
        <path className="vela-af-window-direction" d="M160 38v36" />
        <circle cx="160" cy="56" r="4" />
        {[low, position, high].map((value, index) => (
          <text
            className="vela-af-window-value"
            key={value}
            x={32 + index * 128}
            y="92"
            textAnchor="middle"
          >
            {number(value)}
          </text>
        ))}
        <text x="160" y="114" textAnchor="middle">
          Current / start
        </text>
        <text x="320" y="114" textAnchor="end">
          First sample
        </text>
      </svg>
    </>
  )
}
