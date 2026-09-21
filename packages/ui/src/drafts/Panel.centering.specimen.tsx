import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Panel } from '../components/Panel'
import { Select } from '../components/Select'
import { WorkingIndicator } from '../components/WorkingIndicator'
import { targets } from './target-framing/fixtures'
import './Panel.centering.specimen.css'

type Scenario = 'converges' | 'flip' | 'worsens'

type Stage = 'moving' | 'settling' | 'exposing' | 'downloading' | 'solving' | 'measured'

const scenarios = [
  { value: 'converges', label: 'Normal convergence' },
  { value: 'flip', label: 'Flip, remeasure & recover' },
  { value: 'worsens', label: 'Repeated worsening' },
]

// Choreography for evaluating feedback, not a centering algorithm or sky model.
// The flip example borrows the field-night offsets; its final 0.35′ is invented.
const offsets: Record<Scenario, number[]> = {
  converges: [42.4, 8.95, 2.38, 0.35],
  flip: [42.4, 86.4, 8.95, 2.38, 0.35],
  worsens: [42.4, 53.8, 67.1],
}

const stages: { stage: Stage; label: string; duration: number }[] = [
  { stage: 'moving', label: 'Moving to your composition', duration: 2200 },
  { stage: 'settling', label: 'Waiting for the mount to settle', duration: 1000 },
  { stage: 'exposing', label: 'Taking a 20-second test exposure', duration: 20000 },
  { stage: 'downloading', label: 'Receiving the image', duration: 900 },
  { stage: 'solving', label: 'Measuring the new framing', duration: 1200 },
  { stage: 'measured', label: 'Framing measured', duration: 2200 },
]

const reference = targets[1]!

const arcminutes = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)}′`

function scenarioValue(value: string | number | boolean | undefined): Scenario {
  if (value === 'converges' || value === 'worsens') return value

  return 'flip'
}

function CenteringExample({ scenario }: { scenario: Scenario }) {
  const [step, setStep] = useState(-1)
  const [running, setRunning] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkStep, setCheckStep] = useState(0)
  const [checked, setChecked] = useState(false)
  const [checkMeasurement, setCheckMeasurement] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const measurements = offsets[scenario]
  const totalMoves = measurements.length - 1
  const attempt = Math.min(totalMoves, Math.floor(Math.max(0, step) / stages.length) + 1)
  const stage = stages[Math.max(0, step) % stages.length]!
  const completed = Math.floor((step + 1) / stages.length)
  // Movement lands at the next fixture position when the settling stage begins.
  // A separate check can measure that position without completing the automatic loop.
  const currentPosition = stage.stage === 'moving' ? completed : attempt
  const latestMeasurement = checkMeasurement ?? completed
  const latest = measurements[latestMeasurement]!
  const previous = measurements[Math.max(0, completed - 1)]!
  const finished = completed === totalMoves
  const centered = finished && latest <= 0.5
  const blocked = finished && !centered
  const flipped = scenario === 'flip' && step >= 1
  const measuredFlipped = scenario === 'flip' && latestMeasurement > 0
  const busy = running || checking

  const latestStillMatches =
    !checking && (checked || (!stopped && (step < 0 || stage.stage === 'measured')))

  useEffect(() => {
    if (!running) return

    const timer = window.setTimeout(() => {
      setStep(current => current + 1)

      if (step + 1 === totalMoves * stages.length - 1) setRunning(false)
    }, stage.duration)

    return () => window.clearTimeout(timer)
  }, [running, step, stage.duration, totalMoves])

  useEffect(() => {
    if (!checking) return

    const timer = window.setTimeout(
      () => {
        if (checkStep === 2) {
          setChecking(false)
          setCheckMeasurement(currentPosition)
          setChecked(true)
        } else setCheckStep(current => current + 1)
      },
      checkStep === 0 ? 20000 : 1400,
    )

    return () => window.clearTimeout(timer)
  }, [checking, checkStep, currentPosition])

  let title = 'Ready to center'

  let detail =
    'One request measures and refines the framing until it is within the chosen tolerance.'

  if (running) {
    title = stage.label
    detail = `Correction ${attempt} of at most 4. Each next move uses a fresh solved exposure.`

    if (scenario === 'flip' && attempt === 1) {
      if (stage.stage === 'moving') {
        title = 'Moving across the meridian'
        detail =
          'A flip is expected. A fresh measurement will establish the pointing reference on the other side.'
      } else
        detail = 'Pointing side changed. Measuring this side before deriving another correction.'
    }

    if (stage.stage === 'measured') {
      title = 'Closer — refining automatically'

      if (latest > previous)
        title =
          scenario === 'flip'
            ? 'Flip complete — refining from the new measurement'
            : 'Farther away — checking one fresh correction'
      detail = `${arcminutes(previous)} → ${arcminutes(latest)} from your chosen center.`
    }
  } else if (centered) {
    title = 'Composition centered'
    detail = 'The latest solved frame is within the example 0.5′ tolerance.'
  } else if (blocked) {
    title = 'Centering is not converging'
    detail =
      'Two corrections increased the error. Movement has stopped; inspect the result before trying again.'
  }

  if (stopped && !finished) {
    title = 'Centering stopped'
    detail =
      'No further correction is scheduled. Check the current frame before deciding what to do next.'
  }

  if (checked) {
    title = centered ? 'Composition centered' : 'Current frame measured'
    detail = 'A new example exposure was measured without moving the mount.'
  }

  if (checking) {
    title = ['Taking a check exposure', 'Receiving the image', 'Measuring the current frame'][
      checkStep
    ]!
    detail = 'Checking only. No movement or automatic correction follows this measurement.'
  }

  function start() {
    setChecked(false)
    setCheckMeasurement(null)
    setStopped(false)
    setStep(0)
    setRunning(true)
  }

  function stop() {
    setRunning(false)
    setChecking(false)
    setStopped(true)
    setChecked(false)
  }

  return (
    <article className="vela-centering-demo">
      <header className="vela-centering-shell">
        <strong>Vela</strong>
        <span>Askar FRA 400</span>
        <Badge>Workshop preview</Badge>
      </header>
      <main className="vela-centering-main">
        <header className="vela-centering-heading">
          <p>Observe / Targets</p>
          <h1>Crescent Nebula</h1>
          <span>NGC 6888 · Center your composition</span>
        </header>
        <div className="vela-centering-layout">
          <section className="vela-centering-field-panel" aria-label="Composition comparison">
            <header>
              <strong>Your chosen composition</strong>
              <span>Fixed sky reference</span>
            </header>
            <div className="vela-centering-field">
              <img
                src={reference.image}
                alt="Crescent Nebula reference photograph"
                draggable={false}
              />
              <svg
                viewBox="0 0 600 450"
                role="img"
                aria-label={`Illustrative footprint comparison. Last solved offset ${arcminutes(latest)}. Desired center remains fixed.`}
              >
                <g className="vela-centering-desired">
                  <rect x="150" y="125" width="300" height="200" />
                  <path d="M290 225h20M300 215v20" />
                </g>
                <g
                  className="vela-centering-measured"
                  data-current={latestStillMatches}
                  transform={`translate(${latest * 1.2} ${-latest * 0.65}) rotate(${measuredFlipped ? 180 : 0} 300 225)`}
                >
                  <rect x="150" y="125" width="300" height="200" />
                  <path d="M150 150v-25h25" />
                  <circle cx="300" cy="225" r="3" />
                </g>
              </svg>
            </div>
            <div className="vela-centering-legend">
              <span>
                <i />
                Desired frame
              </span>
              <span>
                <i />
                Last solved frame
                {!latestStillMatches ? ' · previous position' : ''}
              </span>
            </div>
            <footer>
              {'Reference photograph with illustrative footprints, not calibrated sky geometry. '}
              <a href={reference.source} target="_blank" rel="noreferrer">
                Image credit ↗
              </a>
            </footer>
          </section>
          <Panel title="Your composition" className="vela-centering-controls">
            <div className="vela-centering-status" role="status" aria-live="polite">
              <WorkingIndicator active={busy} />
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
            <div className="vela-centering-offset">
              <span>
                {latestStillMatches
                  ? 'Measured distance from center'
                  : 'Last solved distance · current framing unmeasured'}
              </span>
              <strong>{arcminutes(latest)}</strong>
              <span>Started at {arcminutes(measurements[0]!)} · goal ≤ 0.5′</span>
            </div>
            <dl className="vela-centering-facts">
              <div>
                <dt>Exposure</dt>
                <dd>20 s · real-time wait</dd>
              </div>
              <div>
                <dt>Mount pointing side</dt>
                <dd>
                  {scenario === 'flip'
                    ? flipped
                      ? 'East · changed'
                      : 'West · flip expected'
                    : 'East'}
                </dd>
              </div>
            </dl>
            {busy ? (
              <Button onClick={stop}>Stop</Button>
            ) : (
              <>
                {!centered && !blocked && !stopped && (
                  <Button tone="accent" onClick={start}>
                    Center composition
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setChecked(false)
                    setCheckStep(0)
                    setChecking(true)
                  }}
                >
                  Check current frame
                </Button>
              </>
            )}
            {stopped && !finished && (
              <p className="vela-centering-note">
                Use Reset example to replay centering. This sketch does not resume an interrupted
                movement.
              </p>
            )}
          </Panel>
        </div>
        <section className="vela-centering-results" aria-label="Centering measurements">
          <header>
            <h2>Measured progress</h2>
            <span>
              {completed} {completed === 1 ? 'correction' : 'corrections'} measured
            </span>
          </header>
          <ol>
            {measurements.slice(0, completed + 1).map((offset, index) => (
              <li key={index} data-latest={checkMeasurement === null && index === completed}>
                <span>{index === 0 ? 'Before centering' : `Correction ${index}`}</span>
                <strong>{arcminutes(offset)}</strong>
                <span>
                  {index === 0
                    ? 'Starting frame'
                    : offset <= 0.5
                      ? 'Within tolerance'
                      : offset < measurements[index - 1]!
                        ? 'Improved'
                        : scenario === 'flip' && index === 1
                          ? 'Farther · side changed'
                          : 'Worsened'}
                </span>
              </li>
            ))}
          </ol>
        </section>
        <Button
          tone="quiet"
          size="small"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
        >
          Prototype behavior &amp; image source
        </Button>
        {expanded && (
          <div className="vela-centering-notes">
            <p>
              For discussion: finish within 0.5′ (30″), at most four corrections, stop after two
              consecutive worsening results. A flip uses a fresh post-move solve before another
              correction. These are example choices, not adopted operating limits.
            </p>
            <p>
              The reference stays fixed while the marked sensor corner changes with the solved
              pointing side. No raw exposure is rotated or modified. The flip scenario borrows 42.4′
              → 86.4′ → 8.95′ → 2.38′ from the Veil field notes; the Crescent photograph and final
              0.35′ result are illustrative.
            </p>
            <p>
              {'Photo: '}
              {reference.credit}
              {'. '}
              <a
                href="https://creativecommons.org/licenses/by/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY 4.0
              </a>
              . Displayed cropped.
            </p>
          </div>
        )}
      </main>
      <footer className="vela-centering-disclaimer">
        Design sketch · Invented measurements · 20-second exposures; other stages accelerated · No
        device commands
      </footer>
    </article>
  )
}

function CenteringPreview({
  scenario,
  onScenarioChange,
}: {
  scenario: Scenario
  onScenarioChange?: ((scenario: string) => void) | undefined
}) {
  const [localScenario, setLocalScenario] = useState(scenario)
  const [revision, setRevision] = useState(0)
  const selected = onScenarioChange ? scenario : localScenario

  return (
    <div className="vela-centering-example">
      <div className="vela-centering-workshop-controls">
        <Select
          label="Workshop scenario"
          value={selected}
          options={scenarios}
          onChange={event => {
            const value = scenarioValue(event.target.value)

            if (onScenarioChange) onScenarioChange(value)
            else setLocalScenario(value)
          }}
        />
        <Button tone="quiet" onClick={() => setRevision(value => value + 1)}>
          Reset example
        </Button>
      </div>
      <CenteringExample key={`${selected}-${revision}`} scenario={selected} />
    </div>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-centering',
  name: 'Automatic centering · Draft product example',
  description:
    'Automatic centering with a persistent working shimmer, real-time 20-second exposure waits, flip recovery and Stop. Fixture-only workshop exploration; illustrative tolerance and limits, no device commands.',
  controls: {
    scenario: {
      type: 'select',
      label: 'Centering scenario',
      options: scenarios.map(scenario => scenario.value),
    },
  },
  defaultProps: { scenario: 'flip' },
  render: (props, onPropsChange) => (
    <CenteringPreview
      scenario={scenarioValue(props.scenario)}
      onScenarioChange={onPropsChange ? scenario => onPropsChange({ scenario }) : undefined}
    />
  ),
}
