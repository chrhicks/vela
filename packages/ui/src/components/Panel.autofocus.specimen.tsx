import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'
import { Panel } from './Panel'
import './Panel.autofocus.specimen.css'

const phases = ['setup', 'sampling', 'fitting', 'complete', 'restoring', 'restored', 'travel-limit'] as const

const examples = ['current-focus', 'near-inward-limit'] as const

const stepSizes = ['25', '50', '100', '200'] as const

const FRA_START = 32842

const FRA_MAX = 60000

const OFFSET = 4

const FOCUS = 32838

const MIN_HFR = 2.18

const CURVE_B = 95

type Props = Record<string, string | number | boolean>

interface Sample {
  position: number
  hfr: number | null
}

function hyperbola(position: number, p = FOCUS, a = MIN_HFR, b = CURVE_B) {
  return a * Math.sqrt(1 + ((position - p) / b) ** 2)
}

function walkPositions(start: number, stepSize: number, maxStep = FRA_MAX) {
  const high = start + OFFSET * stepSize
  const low = start - OFFSET * stepSize

  if (start < 1 || start > maxStep - 1 || low < 1 || high > maxStep - 1) return null

  const positions: number[] = []

  for (let position = high; position >= low; position -= stepSize) positions.push(position)

  return { positions, low, high }
}

function samplesFor(positions: number[]): Sample[] {
  return positions.map(position => ({ position, hfr: hyperbola(position) }))
}

function minSample(samples: Sample[]) {
  const measured = samples.filter(sample => sample.hfr !== null)

  if (!measured.length) return null

  return measured.reduce((best, sample) => sample.hfr! < best.hfr! ? sample : best)
}

function VCurve({
  start,
  current,
  window,
  samples,
  fit,
}: {
  start: number
  current: number | null
  window: { low: number; high: number }
  samples: Sample[]
  fit: { p: number; a: number; b: number } | null
}) {
  const width = 640
  const height = 280
  const left = 48
  const right = 18
  const top = 16
  const bottom = 44
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const pad = Math.max(window.high - window.low, 1) * 0.08
  const xMin = window.low - pad
  const xMax = window.high + pad
  const hfrs = samples.map(sample => sample.hfr).filter((value): value is number => value !== null)
  const yMax = Math.max(6, ...(hfrs.length ? hfrs : [hyperbola(window.high)]), fit ? hyperbola(window.high, fit.p, fit.a, fit.b) : 0) * 1.12
  const x = (position: number) => left + ((position - xMin) / (xMax - xMin)) * plotWidth
  const y = (hfr: number) => top + (1 - hfr / yMax) * plotHeight
  const ticks = [window.low, start, window.high]
  const latest = samples.at(-1)
  const lowest = minSample(samples)

  const curve = fit
    ? Array.from({ length: 49 }, (_, index) => {
        const position = xMin + (index / 48) * (xMax - xMin)

        return `${index === 0 ? 'M' : 'L'}${x(position).toFixed(1)} ${y(hyperbola(position, fit.p, fit.a, fit.b)).toFixed(1)}`
      }).join(' ')
    : ''

  return (
    <svg className="vela-af-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Autofocus V-curve of focuser position versus star HFR">
      {[0.25, 0.5, 0.75, 1].map(fraction => (
        <line key={fraction} className="vela-af-grid" x1={left} x2={width - right} y1={y(yMax * fraction)} y2={y(yMax * fraction)} />
      ))}
      <line className="vela-af-axis" x1={left} y1={top} x2={left} y2={height - bottom} />
      <line className="vela-af-axis" x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
      <text x={left} y={12}>HFR · px</text>
      <text x={left + plotWidth / 2} y={height - 8} textAnchor="middle">Focuser position</text>
      {ticks.map(tick => (
        <g key={tick}>
          <line className="vela-af-grid" x1={x(tick)} x2={x(tick)} y1={top} y2={height - bottom} />
          <text x={x(tick)} y={height - 22} textAnchor="middle">{tick}</text>
        </g>
      ))}
      <line className="vela-af-start" x1={x(start)} x2={x(start)} y1={top} y2={height - bottom} />
      {fit && <line className="vela-af-fit-line" x1={x(Math.round(fit.p))} x2={x(Math.round(fit.p))} y1={top} y2={height - bottom} />}
      {curve && <path className="vela-af-hyperbola" d={curve} />}
      {lowest && lowest.hfr !== null && (
        <circle className="vela-af-min-sample" cx={x(lowest.position)} cy={y(lowest.hfr)} r="8" />
      )}
      {samples.map((sample, index) => {
        const hfr = sample.hfr ?? yMax * 0.08

        return (
          <circle
            key={sample.position}
            className="vela-af-point"
            data-latest={index === samples.length - 1 || undefined}
            data-empty={sample.hfr === null || undefined}
            cx={x(sample.position)}
            cy={y(hfr)}
            r={index === samples.length - 1 ? 5 : 4}
          />
        )
      })}
      {current !== null && latest && (
        <text x={x(current)} y={Math.max(28, y(latest.hfr ?? yMax * 0.08) - 12)} textAnchor="middle">now</text>
      )}
    </svg>
  )
}

function AutofocusPreview({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const example = String(values.example ?? 'current-focus')
  const start = example === 'near-inward-limit' ? 80 : FRA_START
  const stepSize = Math.max(1, Math.floor(Number(values.stepSize) || 50))
  const phase = phases.find(candidate => candidate === values.phase) ?? 'setup'
  const planned = walkPositions(start, stepSize)
  const plannedCount = planned?.positions.length ?? 0
  const allSamples = planned ? samplesFor(planned.positions) : []
  const [playing, setPlaying] = useState(false)
  const [landed, setLanded] = useState(0)
  const [activity, setActivity] = useState<'moving' | 'exposing'>('moving')

  function update(patch: Props) {
    if (onPropsChange) onPropsChange(patch)
    else setLocal(current => ({ ...current, ...patch }))
  }

  useEffect(() => {
    if (!playing || phase !== 'sampling' || !planned) return

    if (landed >= plannedCount) {
      setPlaying(false)
      update({ phase: 'fitting' })

      return
    }

    setActivity('moving')
    const move = window.setTimeout(() => setActivity('exposing'), 380)
    const land = window.setTimeout(() => setLanded(count => count + 1), 900)

    return () => {
      window.clearTimeout(move)
      window.clearTimeout(land)
    }
  }, [playing, phase, landed, plannedCount])

  useEffect(() => {
    if (phase !== 'fitting') return
    const finish = window.setTimeout(() => update({ phase: 'complete' }), 700)

    return () => window.clearTimeout(finish)
  }, [phase])

  const snapshotCount = phase === 'setup' || phase === 'travel-limit' ? 0
    : playing ? landed
    : phase === 'sampling' ? Math.min(4, allSamples.length)
    : phase === 'restoring' || phase === 'restored' ? (landed > 0 ? landed : Math.min(3, allSamples.length))
    : allSamples.length

  const samples = allSamples.slice(0, snapshotCount)
  const fit = phase === 'complete' ? { p: FOCUS, a: MIN_HFR, b: CURVE_B } : null

  const current = phase === 'complete' && fit ? Math.round(fit.p)
    : phase === 'restored' || phase === 'restoring' || phase === 'setup' || phase === 'travel-limit' ? start
    : samples.at(-1)?.position ?? start

  const travelBlocked = !planned || phase === 'travel-limit' || example === 'near-inward-limit'
  const setup = phase === 'setup' || phase === 'travel-limit'
  const lowest = minSample(samples)
  const latest = samples.at(-1)
  const busy = phase === 'sampling' || phase === 'fitting' || phase === 'restoring'
  const windowRange = planned ?? { low: Math.max(1, start - OFFSET * stepSize), high: start + OFFSET * stepSize }

  const activityLabels = {
    sampling: activity === 'moving'
      ? `Moving to ${planned?.positions[landed] ?? current}…`
      : `Exposing at ${planned?.positions[landed] ?? current}…`,
    fitting: 'Fitting the hyperbola…',
    restoring: `Restoring start ${start}…`,
    complete: 'Fitted focus is ready',
    restored: 'Walk stopped · start restored',
    setup: 'Ready to start from the current position',
    'travel-limit': 'Ready to start from the current position',
  }

  const activityLabel = activityLabels[phase]

  const settledGuidance = {
    complete: 'The fitted minimum is an integer step inside the sampled window. The lowest sampled HFR is shown only for comparison.',
    restored: 'Start a new walk from the current position when you are ready.',
  }

  const badge = setup ? (travelBlocked ? 'Blocked' : 'Not started')
    : phase === 'sampling' ? 'Walking'
    : phase === 'fitting' ? 'Fitting'
    : phase === 'complete' ? 'Complete'
    : phase === 'restoring' ? 'Restoring'
    : 'Restored'

  function startWalk() {
    if (travelBlocked) return

    setLanded(0)
    setPlaying(true)
    update({ phase: 'sampling' })
  }

  const readout = (
    <Panel className="vela-af-readout">
      <dl>
        <div><dt>Start</dt><dd>{start}</dd></div>
        <div><dt>Current</dt><dd>{current}</dd></div>
        <div>
          <dt>Latest sample</dt>
          <dd>{latest ? latest.hfr === null ? `${latest.position} · no stars` : `${latest.position} · ${latest.hfr.toFixed(2)} px` : '—'}</dd>
        </div>
        <div>
          <dt>Fitted focus</dt>
          <dd>{fit ? Math.round(fit.p) : '—'}</dd>
        </div>
        <div>
          <dt>Min-sample</dt>
          <dd>{lowest ? lowest.position : '—'}</dd>
        </div>
      </dl>
      <div className="vela-af-activity">
        <div className="vela-af-activity__line" role="status">
          {busy ? <span className="vela-af-activity__spinner" aria-hidden="true" /> : null}
          <strong>{activityLabel}</strong>
        </div>
        <p>{samples.length ? `${samples.length} of ${allSamples.length || OFFSET * 2 + 1} shorts on the curve.` : 'No samples yet. The graph fills as each short exposure lands.'}</p>
      </div>
    </Panel>
  )

  const chart = (
    <Panel className="vela-af-chart-panel">
      <div className="vela-af-chart-heading">
        <span>Star HFR as the focuser walks</span>
        <span>Window around start · not a home to 0</span>
      </div>
      <VCurve start={start} current={phase === 'setup' || phase === 'travel-limit' ? start : current} window={windowRange} samples={samples} fit={fit} />
      <div className="vela-af-legend">
        <span><i data-kind="start" /> Start</span>
        <span><i data-kind="sample" /> Sample</span>
        <span><i data-kind="curve" /> Hyperbola</span>
        <span><i data-kind="fit" /> Fitted minimum</span>
      </div>
    </Panel>
  )

  return (
    <article className="vela-af-demo">
      <header className="vela-af-shell"><strong>Vela</strong><span>Askar FRA 400</span><span>Observe</span></header>
      <main className="vela-af-main">
        <header className="vela-af-heading">
          <div><p>Rig preparation</p><h1>Autofocus</h1></div>
          <Badge tone={(setup && travelBlocked) || phase === 'restored' ? 'warning' : busy ? 'accent' : phase === 'complete' ? 'positive' : 'neutral'}>{badge}</Badge>
        </header>
        {setup && travelBlocked && (
          <div className="vela-af-notice" role="alert">
            <strong>Walk would approach a travel limit</strong>
            <p>Vela stays at the current EAF position. It does not command 0 or MaxStep, and it will not start a window that cannot fit around start.</p>
          </div>
        )}
        {phase === 'restored' && (
          <div className="vela-af-notice" role="status">
            <strong>Start position restored</strong>
            <p>The walk stopped before a fitted focus. The focuser is back at {start}, the position where this session began.</p>
          </div>
        )}
        {setup ? (
          <div className="vela-af-setup">
            <Panel>
              <h2>Focus from where you are</h2>
              <p>Vela will jump a little outward from the current EAF position, walk back through focus, and plot star size at each stop. Cancel returns here. Position 0 is a mechanical stop, not a home, and not backlash compensation off.</p>
              <dl className="vela-af-facts">
                <div><dt>Current position</dt><dd>{start}</dd></div>
                <div><dt>MaxStep</dt><dd>{FRA_MAX}</dd></div>
                <div><dt>Window</dt><dd>{planned ? `${planned.low} → ${planned.high}` : 'Does not fit around start'}</dd></div>
              </dl>
              <Input
                label="Step size"
                type="number"
                min={1}
                max={2000}
                value={String(stepSize)}
                onChange={event => update({ stepSize: String(Math.max(1, Math.floor(Number(event.target.value) || 1))) })}
                message="Steps between shorts. Large enough that HFR changes; small enough to stay inside the window."
              />
            </Panel>
            <div className="vela-af-next">
              <h3>Before you start</h3>
              <p>Each point on the graph is one short exposure. You will see start, current position, and the fitted minimum once the hyperbola exists.</p>
              <p>The walk stays inside a window around the current position. Vela will not command 0 or MaxStep.</p>
              <Button size="large" tone="accent" disabled={travelBlocked} onClick={startWalk}>{travelBlocked ? 'Window does not fit' : 'Start autofocus'}</Button>
            </div>
          </div>
        ) : (
          <div className="vela-af-layout">
            {chart}
            {readout}
            <div className="vela-af-actions">
              <p>
                {phase === 'complete' || phase === 'restored'
                  ? settledGuidance[phase]
                  : 'Points appear as each short lands. Stop restores the start position; Vela will not keep walking toward a limit.'}
              </p>
              {busy ? (
                <Button size="large" onClick={() => { setPlaying(false); update({ phase: 'restored' }) }}>Stop and restore start</Button>
              ) : (
                <Button size="large" tone="accent" onClick={() => { setLanded(0); update({ phase: 'setup' }) }}>
                  {phase === 'complete' ? 'Focus again' : 'Back to setup'}
                </Button>
              )}
            </div>
          </div>
        )}
        <footer className="vela-af-prototype">Workshop prototype · simulated shorts · no focuser commands</footer>
      </main>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-autofocus',
  name: 'Autofocus · Product example',
  description: 'Observe one-shot Star-HFR walk with a live V-curve. Start plays simulated shorts so each (position, HFR) point appears as it lands, with start, current, and fitted-minimum readout. Illustrative FRA window around the current EAF position; no hardware moves, no Move(0). A window that cannot fit stays on setup with the command disabled. Backlash compensation is not shown as a device fact.',
  controls: {
    example: { type: 'select', label: 'Starting place', options: examples },
    phase: { type: 'select', label: 'Activity', options: phases },
    stepSize: { type: 'select', label: 'Step size', options: stepSizes },
  },
  defaultProps: { example: 'current-focus', phase: 'setup', stepSize: '50' },
  render: (props, onPropsChange) => <AutofocusPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
