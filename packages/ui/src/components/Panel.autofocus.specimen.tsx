import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Button } from './Button'
import { Input } from './Input'
import { PreparationSpecimenHeader } from './Panel.polar-alignment-inspection'
import './Panel.polar-alignment.specimen.css'
import './Panel.autofocus.specimen.css'

const phases = [
  'setup',
  'sampling',
  'fitting',
  'confirming',
  'complete',
  'restoring',
  'restored',
  'travel-limit',
  'interrupted',
  'offline',
  'restore-unconfirmed',
] as const

const examples = ['current-focus', 'near-inward-limit'] as const

const stepSizes = ['25', '50', '100', '200'] as const

const FRA_START = 32842

const FRA_MAX = 60000

const OFFSET = 4

const FOCUS = 32788

const MIN_HFR = 2.18

const CURVE_B = 120

const referenceHfr = [5.1, 4.4, 3.65, 2.95, 2.45, 2.18, 2.48, 3.05, 3.75]

type Props = Record<string, string | number | boolean>

interface Sample {
  position: number
  hfr: number
}

const number = (value: number) => value.toLocaleString('en-US')

const hyperbola = (position: number) =>
  MIN_HFR * Math.sqrt(1 + ((position - FOCUS) / CURVE_B) ** 2)

function VCurve({
  start,
  low,
  high,
  samples,
  fit,
  compact = false,
}: {
  start: number
  low: number
  high: number
  samples: Sample[]
  fit: boolean
  compact?: boolean
}) {
  const width = compact ? 320 : 838
  const height = compact ? 146 : 280
  const left = compact ? 32 : 64
  const right = compact ? 14 : 24
  const top = compact ? 18 : 32
  const bottom = compact ? 32 : 56
  const pad = (high - low) * 0.08

  const x = (value: number) =>
    left +
    ((value - low + pad) / (high - low + pad * 2)) * (width - left - right)

  const max = Math.max(
    6,
    Math.ceil(
      Math.max(
        ...samples.map((sample) => sample.hfr),
        fit ? hyperbola(high) : 0,
      ) / 2,
    ) * 2,
  )

  const y = (value: number) => top + (1 - value / max) * (height - top - bottom)

  const lowest = samples.length
    ? samples.reduce((a, b) => (a.hfr < b.hfr ? a : b))
    : null

  const curve = Array.from({ length: 49 }, (_, index) => {
    const position = low - pad + (index / 48) * (high - low + 2 * pad)

    return `${index ? 'L' : 'M'}${x(position)} ${y(hyperbola(position))}`
  }).join(' ')

  return (
    <svg
      className={`vela-af-chart ${compact ? 'vela-af-chart--compact' : 'vela-af-chart--desktop'}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Autofocus V-curve of focuser position versus star HFR"
    >
      {(compact ? [0, 0.5, 1] : [0, 1 / 3, 2 / 3, 1]).map((fraction) => (
        <g key={fraction}>
          <line
            className="vela-af-grid"
            x1={left}
            x2={width - right}
            y1={y(fraction * max)}
            y2={y(fraction * max)}
          />
          <text x={left - 20} y={y(fraction * max) + 5} textAnchor="end">
            {Number((fraction * max).toFixed(1))}
          </text>
        </g>
      ))}
      <path
        className="vela-af-axis"
        d={`M${left} ${top}V${height - bottom}H${width - right}`}
      />
      <line
        className="vela-af-start"
        x1={x(start)}
        x2={x(start)}
        y1={top}
        y2={height - bottom}
      />
      {[low, start, high].map((value) => (
        <text
          key={value}
          x={x(value)}
          y={height - (compact ? 7 : 31)}
          textAnchor="middle"
        >
          {number(value)}
        </text>
      ))}
      {!compact && (
        <>
          <text x={left} y={17}>
            HFR · px
          </text>
          <text x={x(start)} y={17} textAnchor="middle">
            Start {number(start)}
          </text>
          <text
            x={(left + width - right) / 2}
            y={height - 5}
            textAnchor="middle"
          >
            Focuser position
          </text>
        </>
      )}
      {fit && (
        <>
          <path className="vela-af-hyperbola" d={curve} />
          <line
            className="vela-af-fit-line"
            x1={x(FOCUS)}
            x2={x(FOCUS)}
            y1={top}
            y2={height - bottom}
          />
        </>
      )}
      {samples.map((sample, index) => (
        <circle
          key={sample.position}
          className="vela-af-point"
          cx={x(sample.position)}
          cy={y(sample.hfr)}
          r={
            compact
              ? index === samples.length - 1
                ? 4.5
                : 4
              : index === samples.length - 1
                ? 6
                : 5
          }
        />
      ))}
      {lowest && (
        <circle
          className="vela-af-min-sample"
          cx={x(lowest.position)}
          cy={y(lowest.hfr)}
          r={compact ? 8 : 10}
        />
      )}
    </svg>
  )
}

function AutofocusPreview({
  props,
  onPropsChange,
}: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const phase = phases.find((value) => value === values.phase) ?? 'setup'

  const start =
    phase === 'travel-limit' || values.example === 'near-inward-limit'
      ? 150
      : FRA_START

  const step = Math.max(1, Math.floor(Number(values.stepSize) || 50))
  const low = start - OFFSET * step
  const high = start + OFFSET * step
  const setup = phase === 'setup' || phase === 'travel-limit'
  const blocked = low < 1 || high >= FRA_MAX || phase === 'travel-limit'
  const interrupted = phase === 'interrupted'
  const offline = phase === 'offline'
  const complete = phase === 'complete'
  const failed = phase === 'restore-unconfirmed'
  const stopped = phase === 'restored'
  const restoring = phase === 'restoring'
  const active = !setup && !complete && !failed && !stopped
  const [playing, setPlaying] = useState(false)
  const [landed, setLanded] = useState(0)
  const [walkStarted, setWalkStarted] = useState(false)
  const [activity, setActivity] = useState<'moving' | 'exposing'>('exposing')

  const update = (patch: Props) =>
    onPropsChange
      ? onPropsChange(patch)
      : setLocal((value) => ({ ...value, ...patch }))

  useEffect(() => {
    if (!playing || phase !== 'sampling') return

    if (landed >= 9) {
      update({ phase: 'fitting' })

      return
    }

    setActivity('moving')
    const moving = window.setTimeout(() => setActivity('exposing'), 380)

    const capture = window.setTimeout(
      () => setLanded((value) => value + 1),
      900,
    )

    return () => {
      clearTimeout(moving)
      clearTimeout(capture)
    }
  }, [playing, phase, landed])
  useEffect(() => {
    if (!['fitting', 'confirming', 'restoring'].includes(phase) || !playing)
      return

    const next = new Map([
      ['fitting', 'confirming'],
      ['restoring', 'restored'],
      ['confirming', 'complete'],
    ]).get(phase)

    if (!next) return
    const timer = window.setTimeout(() => update({ phase: next }), 900)

    return () => clearTimeout(timer)
  }, [phase, playing])

  const count = setup
    ? 0
    : walkStarted && !complete && phase !== 'fitting' && phase !== 'confirming'
      ? landed
      : complete || phase === 'fitting' || phase === 'confirming'
        ? 9
        : 5

  const samples = Array.from({ length: count }, (_, index) => ({
    position: high - index * step,
    hfr:
      step === 50 && start === FRA_START
        ? referenceHfr[index]!
        : hyperbola(high - index * step),
  }))

  const latest = samples.at(-1)

  const lowest = samples.length
    ? samples.reduce((a, b) => (a.hfr < b.hfr ? a : b))
    : null

  const current = stopped
    ? start
    : complete || phase === 'confirming'
      ? FOCUS
      : restoring
        ? start
        : high - Math.min(count, 8) * step

  const fit = complete || phase === 'confirming'

  const badge = offline
    ? 'Connection interrupted'
    : interrupted
      ? 'Camera observation interrupted'
      : failed
        ? 'Start position not confirmed'
        : stopped
          ? 'Start position restored'
          : restoring
            ? 'Restoring start…'
            : complete
              ? 'Focus confirmed'
              : phase === 'fitting'
                ? 'Fitting'
                : phase === 'confirming'
                  ? 'Confirming'
                  : setup
                    ? blocked
                      ? 'Walk would approach a travel limit'
                      : 'Ready to start'
                    : 'Walking'

  const action = () => {
    if (active) {
      setPlaying(true)
      update({ phase: 'restoring' })
    } else {
      setPlaying(false)
      setLanded(0)
      setWalkStarted(false)
      update({ phase: 'setup' })
    }
  }

  const actionLabel = active
    ? 'Stop and restore start'
    : complete
      ? 'Focus again'
      : 'Back to setup'

  const outcomeByPhase = {
    interrupted: {
      eyebrow: 'Camera read retry',
      title: 'Waiting for the same exposure',
      body: 'Samples and the last sample time stay visible. The focuser does not advance while camera reads retry.',
      fact: `Last sample 21:03:10 · ${count} measured samples`,
      footer: 'Server connected · Stop remains available',
      tone: 'warning',
    },
    complete: {
      eyebrow: 'Confirmed completion',
      title: 'Fitted focus is ready',
      body: `Focuser position ${number(FOCUS)} is confirmed. The fitted minimum and lowest measured sample remain distinct.`,
      fact: `Fitted focus ${number(FOCUS)} · Lowest sample ${number(lowest?.position ?? start)}`,
      footer: 'Return to setup before another walk',
      tone: 'active',
    },
    restored: {
      eyebrow: 'Confirmed stop',
      title: 'Start position restored',
      body: `The walk stopped before a fitted focus. The focuser is back at ${number(start)}, where this session began.`,
      fact: `Stopped · Current position ${number(start)}`,
      footer: 'Retain the curve and completed samples',
      tone: 'active',
    },
    'restore-unconfirmed': {
      eyebrow: 'Restoration failed',
      title: 'Start position not confirmed',
      body: `The run failed and return to ${number(start)} was not confirmed. Vela did not repeat the move. Retain the measured curve.`,
      fact: 'Current position is the last received reading',
      footer: 'Action availability follows the server state',
      tone: 'danger',
    },
    offline: {
      eyebrow: 'Browser connection lost',
      title: 'Autofocus state is unknown',
      body: 'Keep the last received curve and readings. Hide live activity while reconnecting; do not present a successful stop.',
      fact: 'Last sample 21:03:10 · Readings interrupted',
      footer: 'Unavailable until the server can be reached',
      tone: 'warning',
    },
  }

  const outcome =
    setup && blocked
      ? {
          eyebrow: 'Setup · Travel limit',
          title: 'Window does not fit',
          body: `At position ${number(start)}, step size ${step} would put this window across a mechanical limit. Adjust the step size before starting.`,
          fact: 'Position 0 and MaxStep are mechanical limits',
          footer: 'No movement commanded · Stay in setup',
          tone: 'warning',
        }
      : Object.entries(outcomeByPhase).find(
          ([candidate]) => candidate === phase,
        )?.[1]

  const outcomeCard = outcome && (
    <section
      className="vela-af-outcome"
      data-tone={outcome.tone}
      role={failed || blocked ? 'alert' : 'status'}
    >
      <p className="vela-af-outcome-eyebrow">{outcome.eyebrow}</p>
      <h2>{outcome.title}</h2>
      <p className="vela-af-outcome-body">{outcome.body}</p>
      <p className="vela-af-outcome-fact">{outcome.fact}</p>
      <Button disabled={offline || blocked} onClick={action}>
        {blocked ? 'Window does not fit' : actionLabel}
      </Button>
      <p className="vela-af-outcome-footer">{outcome.footer}</p>
    </section>
  )

  const actionButton = (
    <Button tone="accent" disabled={offline || restoring} onClick={action}>
      {restoring ? 'Restoring start…' : actionLabel}
    </Button>
  )

  return (
    <article className="vela-af-demo vela-theme">
      <PreparationSpecimenHeader />
      <main className="vela-af-main">
        <header className="vela-af-heading">
          <a href="#tonight" onClick={(event) => event.preventDefault()}>
            ← Tonight
          </a>
          <h1>Autofocus</h1>
          <span>Askar FRA 400 · Rig preparation</span>
        </header>
        {setup ? (
          <div className="vela-af-setup">
            <section className="vela-af-chart-panel">
              <h2>Focus from where you are</h2>
              <p className="vela-af-intro">
                Vela samples star size in a small window around the current
                position, then fits the curve to find focus.
              </p>
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
                {Array.from({ length: 9 }, (_, index) => (
                  <path
                    className="vela-af-window-axis"
                    key={index}
                    d={`M${56 + index * 90.75} 79v20`}
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
                  {number(start)}
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
                aria-label={`Planned window ${number(low)} to ${number(high)}. Current position and session start ${number(start)}. First sample ${number(high)}, then samples walk inward.`}
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
                {Array.from({ length: 9 }, (_, index) => (
                  <path
                    className="vela-af-window-axis"
                    key={index}
                    d={`M${32 + index * 32} 49v14`}
                  />
                ))}
                <path className="vela-af-window-direction" d="M160 38v36" />
                <circle cx="160" cy="56" r="4" />
                {[low, start, high].map((value, index) => (
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
              <dl className="vela-af-window-facts">
                <div>
                  <dt>Planned window</dt>
                  <dd>
                    {number(low)} – {number(high)}
                  </dd>
                </div>
                <div>
                  <dt>Short exposure</dt>
                  <dd>2 seconds per sample</dd>
                </div>
                <div>
                  <dt>Samples before fitting</dt>
                  <dd>9 planned</dd>
                </div>
              </dl>
              <p className="vela-af-panel-note">
                Position 0 and MaxStep are mechanical limits. Vela will not
                command either limit.
              </p>
            </section>
            <aside className="vela-af-side">
              {blocked ? (
                outcomeCard
              ) : (
                <div className="vela-af-status vela-af-ready" role="status">
                  <strong>
                    <i className="vela-af-status-dot" aria-hidden="true" />
                    Ready to start
                  </strong>
                  <p>Camera and focuser are available.</p>
                </div>
              )}
              <dl className="vela-af-facts">
                <div>
                  <dt>Imaging camera</dt>
                  <dd>ZWO ASI2600MC Pro</dd>
                </div>
                <div>
                  <dt>Focuser</dt>
                  <dd>ZWO EAF</dd>
                </div>
                <div>
                  <dt>Maximum position · MaxStep</dt>
                  <dd>{number(FRA_MAX)}</dd>
                </div>
              </dl>
              <div className="vela-af-step">
                <Input
                  label="Step size"
                  type="number"
                  min={1}
                  max={2000}
                  value={String(step)}
                  onChange={(event) => update({ stepSize: event.target.value })}
                  message="Distance between samples. Keep the window inside the focuser’s travel."
                />
                <span className="vela-af-step-suffix" aria-hidden="true">
                  steps
                </span>
              </div>
              {!blocked && (
                <>
                  <Button
                    tone="accent"
                    onClick={() => {
                      setLanded(0)
                      setWalkStarted(true)
                      setPlaying(true)
                      update({ phase: 'sampling' })
                    }}
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
              <VCurve
                start={start}
                low={low}
                high={high}
                samples={samples}
                fit={fit}
              />
              <VCurve
                start={start}
                low={low}
                high={high}
                samples={samples}
                fit={fit}
                compact
              />
              <p className="vela-af-mobile-label">
                Focuser position ·{' '}
                {fit ? 'Fitted curve' : 'No fitted curve yet'}
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
                {fit
                  ? 'Fitted focus and the lowest measured sample are separate results.'
                  : 'No fitted curve yet. The fitted minimum appears only after the server completes the fit.'}
              </p>
            </section>
            {outcomeCard || (
              <div className="vela-af-status" role="status">
                <div className="vela-af-status-line">
                  <strong>
                    {phase === 'sampling' && (
                      <i className="vela-af-status-dot" aria-hidden="true" />
                    )}
                    {badge}
                  </strong>
                  <span>{count} of 9 samples</span>
                </div>
                <p className="vela-af-desktop-activity">
                  {phase === 'sampling'
                    ? activity === 'moving'
                      ? 'Moving to next position'
                      : 'Exposing at current position'
                    : badge}
                </p>
                <p className="vela-af-mobile-activity">
                  {phase === 'sampling'
                    ? `${activity === 'moving' ? 'Moving to' : 'Exposing at'} ${number(current)}…`
                    : badge}
                </p>
                <strong className="vela-af-current">{number(current)}</strong>
                <p className="vela-af-support vela-af-exposure">
                  {phase === 'sampling' ? (
                    <>
                      2-second exposure
                      <span> · Waiting for the next sample</span>
                    </>
                  ) : (
                    'Waiting for confirmation'
                  )}
                </p>
                <div className="vela-af-desktop-action">{actionButton}</div>
              </div>
            )}
            <dl className="vela-af-readout">
              <div>
                <dt>Start position</dt>
                <dd>{number(start)}</dd>
              </div>
              <div>
                <dt>Latest sample</dt>
                <dd>
                  {latest
                    ? `${number(latest.position)} · ${latest.hfr.toFixed(2)} px`
                    : '—'}
                </dd>
              </div>
              <div className="vela-af-desktop-fact">
                <dt>Fitted focus</dt>
                <dd>{fit ? number(FOCUS) : '—'}</dd>
              </div>
              <div className="vela-af-desktop-fact">
                <dt>Lowest measured sample</dt>
                <dd>{lowest ? number(lowest.position) : '—'}</dd>
              </div>
              <div className="vela-af-mobile-fact">
                <dt>Last sample</dt>
                <dd>{latest ? '21:03:10' : '—'}</dd>
              </div>
            </dl>
            {!outcome && (
              <div className="vela-af-actions">
                <p className="vela-af-desktop-help">
                  Last sample {latest ? '21:03:10' : 'unavailable'}. Stop
                  requests a return to {number(start)}; the result is shown when
                  confirmed.
                </p>
                <p className="vela-af-mobile-help">
                  Stop ends the walk and requests a return to the start
                  position.
                </p>
                <div className="vela-af-mobile-action">{actionButton}</div>
              </div>
            )}
          </div>
        )}
        <footer className="vela-af-prototype">
          <span>
            {setup
              ? 'Window is checked before movement.'
              : `Step ${step} · Window ${number(low)}–${number(high)}`}
          </span>
          <span>
            Workshop prototype · simulated shorts · no focuser commands
          </span>
        </footer>
      </main>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-autofocus',
  name: 'Autofocus · Product example',
  description:
    'Fieldroom one-shot Star-HFR walk. Fixed Paper samples, an accelerated interactive walk, explicit camera-read interruption and confirmed versus unconfirmed restoration. No device commands or backlash claims. Appearance radios demonstrate selection; workshop palette remains independently controlled.',
  controls: {
    example: { type: 'select', label: 'Starting place', options: examples },
    phase: { type: 'select', label: 'Activity', options: phases },
    stepSize: { type: 'select', label: 'Step size', options: stepSizes },
  },
  defaultProps: { example: 'current-focus', phase: 'setup', stepSize: '50' },
  render: (props, onPropsChange) => (
    <AutofocusPreview
      props={props}
      {...(onPropsChange ? { onPropsChange } : {})}
    />
  ),
}
