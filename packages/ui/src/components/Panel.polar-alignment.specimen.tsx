import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Panel } from './Panel'
import './Panel.polar-alignment.specimen.css'

const examples = ['large-error', 'near-aligned'] as const
const phases = ['setup', 'point-1', 'moving-2', 'point-2', 'moving-3', 'point-3', 'baseline-stopped', 'adjusting', 'exposing', 'debayering', 'stretching', 'solving', 'retrying', 'stopped', 'finished'] as const

const activityFrames: Record<string, { label: string; age: string }> = {
  adjusting: { label: 'Alignment updated', age: 'Just now' },
  exposing: { label: 'Exposing image', age: '7 s ago' },
  waiting: { label: 'Exposing image', age: '7 s ago' },
  debayering: { label: 'Debayering image…', age: '32 s ago' },
  stretching: { label: 'Stretching image…', age: '33 s ago' },
  solving: { label: 'Plate-solving…', age: '35 s ago' },
  retrying: { label: 'Exposing another image', age: '1 min 7 s ago' },
  stopped: { label: 'Measurements stopped', age: 'At stop · 35 s old' },
  finished: { label: 'Alignment ended by you', age: 'At finish · 2 s old' },
}

const measurementSteps: Record<string, { point: number; solved: number; label: string; next: string }> = {
  'point-1': { point: 1, solved: 0, label: 'Taking and solving the first image…', next: 'moving-2' },
  'moving-2': { point: 2, solved: 1, label: 'Moving to the second position…', next: 'point-2' },
  'point-2': { point: 2, solved: 1, label: 'Taking and solving the second image…', next: 'moving-3' },
  'moving-3': { point: 3, solved: 2, label: 'Moving to the third position…', next: 'point-3' },
  'point-3': { point: 3, solved: 2, label: 'Taking and solving the final image…', next: 'adjusting' },
}

function BaselinePreview({ phase, physical, onStart, onStop }: {
  readonly phase: string
  readonly physical: boolean
  readonly onStart: () => void
  readonly onStop: () => void
}) {
  const step = measurementSteps[phase]
  const stopped = phase === 'baseline-stopped'
  return (
    <div className="vela-polar-baseline">
      <Panel className="vela-polar-baseline__summary">
        <h2>{step ? 'Measuring your alignment' : stopped ? 'Measurement stopped' : 'Find your starting alignment'}</h2>
        <p>{step ? 'Keep the mount’s adjustment knobs still while Vela measures three positions.' : stopped ? 'No alignment result was calculated. Start again when you’re ready for a fresh set of measurements.' : 'Vela will take and solve images at three positions, then show you how to adjust the mount.'}</p>
        <ol className="vela-polar-points" aria-label="Three measurement positions">
          {[1, 2, 3].map(point => (
            <li key={point} data-state={step && point <= step.solved ? 'done' : step?.point === point ? 'current' : 'pending'}>
              <span>{step && point <= step.solved ? '✓' : point}</span>
              <strong>Position {point}</strong>
              <small>{step && point <= step.solved ? 'Solved' : step?.point === point ? phase.startsWith('moving') ? 'Moving' : 'Measuring' : 'Not measured'}</small>
            </li>
          ))}
        </ol>
        {step ? (
          <div className="vela-polar-activity">
            <div className="vela-polar-activity__line" role="status"><span className="vela-polar-activity__spinner" aria-hidden="true" /><strong>{step.label}</strong></div>
            <p>{step.solved} of 3 positions solved · Alignment error not yet available</p>
          </div>
        ) : (
          <dl className="vela-polar-setup-facts"><div><dt>Camera</dt><dd>{physical ? 'ASI2600MC Pro' : 'Main imaging camera'}</dd></div><div><dt>Exposure</dt><dd>30 seconds</dd></div><div><dt>Starting point</dt><dd>{physical ? 'Current prepared sky patch' : 'Current position'}</dd></div></dl>
        )}
      </Panel>
      <div className="vela-polar-baseline__next">
        <h3>{step ? 'What happens next' : 'Before you start'}</h3>
        <p>{step ? 'After the third solve, the adjustment view will show your alignment error and the target reticle.' : physical ? 'Prepare a clear sky patch and a clear movement corridor: Vela checks RA direction within 1° on either side, then rotates RA westward in two roughly 18° steps. Allow up to 40° total westward movement.' : 'Point toward a clear patch of sky. Starting measurement will move the telescope through three positions along its rotation axis.'}</p>
        <p>{step ? 'You can stop the measurement at any time.' : physical ? 'Use sidereal tracking. Keep the mount’s adjustment knobs still until all three positions are measured. You can stop at any time.' : 'Leave room for the movement, and keep the adjustment knobs still until measurement finishes.'}</p>
        <Button size="large" tone={step ? 'neutral' : 'accent'} onClick={step ? onStop : onStart}>{step ? 'Stop measurement' : stopped ? 'Start again' : 'Start measurement'}</Button>
      </div>
    </div>
  )
}

function AlignmentPreview({ props, onPropsChange }: {
  readonly props: Record<string, string | number | boolean>
  readonly onPropsChange?: (patch: Record<string, string | number | boolean>) => void
}) {
  const [localPhase, setLocalPhase] = useState(String(props.phase ?? 'setup'))
  const [playing, setPlaying] = useState(false)
  const phase = onPropsChange ? String(props.phase) : localPhase
  const baseline = phase === 'setup' || phase === 'baseline-stopped' || phase in measurementSteps
  const near = props.example === 'near-aligned'
  const inactive = phase === 'stopped' || phase === 'finished'
  const busy = !inactive && phase !== 'adjusting'
  const exposing = phase === 'exposing' || phase === 'waiting' || phase === 'retrying'
  const retrying = phase === 'retrying'
  const activity = activityFrames[phase] ?? activityFrames.adjusting!

  const x = near ? 394 : 165
  const y = near ? 175 : 300
  function changePhase(value: string, play = false) {
    setPlaying(play)
    if (onPropsChange) onPropsChange({ phase: value })
    else setLocalPhase(value)
  }

  useEffect(() => {
    const step = measurementSteps[phase]
    if (!playing || !step) return
    const timer = window.setTimeout(() => {
      if (step.next === 'adjusting') setPlaying(false)
      if (onPropsChange) onPropsChange({ phase: step.next })
      else setLocalPhase(step.next)
    }, 1_600)
    return () => window.clearTimeout(timer)
  }, [phase, playing, onPropsChange])

  return (
    <article className="vela-polar-demo">
      <header className="vela-polar-shell"><strong>Vela</strong><span>Askar FRA 400</span><span>Observe</span></header>
      <main className="vela-polar-main">
        <header className="vela-polar-heading">
          <div><p>Rig preparation</p><h1>Polar alignment</h1></div>
          <Badge tone={inactive ? 'neutral' : 'accent'}>{baseline ? measurementSteps[phase] ? 'Measuring' : phase === 'baseline-stopped' ? 'Stopped' : 'Not started' : phase === 'finished' ? 'Finished' : phase === 'stopped' ? 'Stopped' : busy ? 'Measuring' : 'Adjusting'}</Badge>
        </header>
        {retrying && <div className="vela-polar-solve-warning" role="alert">
          <strong>Plate-solving failed</strong>
          <p>Trying another image. Showing the last successful solve.</p>
        </div>}
        {baseline ? <BaselinePreview phase={phase} physical={props.mode === 'physical'} onStart={() => changePhase('point-1', true)} onStop={() => changePhase('baseline-stopped')} /> : (
        <div className="vela-polar-layout">
          <Panel className="vela-polar-readings">
            <div className="vela-polar-total"><span>{inactive || busy ? 'Last measured error' : 'Total alignment error'}</span><strong>{near ? '14″' : '8′ 23″'}</strong></div>
            <div className="vela-polar-directions" aria-label="Mount adjustment directions">
              <div><span>Azimuth · horizontal</span><strong>→ {near ? '11″' : '7′ 20″'}</strong><span>{inactive || busy ? 'Last correction: right' : 'Move right'}</span></div>
              <div><span>Altitude · vertical</span><strong>↑ {near ? '9″' : '4′ 04″'}</strong><span>{inactive || busy ? 'Last correction: up' : 'Move up'}</span></div>
            </div>
            <div className="vela-polar-activity" data-warning={retrying || undefined}>
              <div className="vela-polar-activity__line" role="status">
                {busy ? <span className="vela-polar-activity__spinner" aria-hidden="true" /> : null}
                <strong>{activity.label}</strong>
                {exposing ? <span className="vela-polar-activity__time">5 / 30 s</span> : null}
              </div>
              {exposing ? <progress value={5} max={30} aria-label="Exposure progress in seconds" /> : null}
              <div className="vela-polar-activity__age"><span>Last alignment update</span><span>{activity.age}</span></div>
              <p>{busy ? 'Wait for the next alignment update before adjusting again.' : inactive ? 'Readings and overlay are from the last successful solve.' : 'The readings and overlay are ready for your next adjustment.'}</p>
            </div>
          </Panel>

          <figure className="vela-polar-image">
            <div className="vela-polar-image-heading"><span>{inactive || busy ? 'Last solved frame' : 'Alignment view'}</span><span>20′ field · fixed scale</span></div>
            <svg viewBox="0 0 640 400" role="img" aria-label={near ? 'Reference star almost centered in the target reticle' : 'Reference star far below and left of the target reticle'}>
              <rect width="640" height="400" fill="#090e18" />
              {Array.from({ length: 115 }, (_, i) => (
                <circle key={i} cx={(i * 173 + 31) % 640} cy={(i * i * 29 + 17) % 400} r={i % 13 === 0 ? 1.7 : 0.65} fill="#e1e8f6" opacity={0.25 + (i % 6) * 0.12} />
              ))}
              <g fill="none" stroke="var(--vela-polar-target)" strokeWidth="1.4">
                <circle cx="400" cy="170" r="32" opacity="0.55" />
                <circle cx="400" cy="170" r="16" />
                <path d="M352 170h36m24 0h36M400 122v36m0 24v36" />
              </g>
              <path d={`M${x} ${y}H400V170`} fill="none" stroke="var(--vela-polar-reference)" strokeWidth="1.4" strokeDasharray="5 5" opacity="0.8" />
              <line x1={x} y1={y} x2="400" y2="170" stroke="var(--vela-polar-reference)" strokeWidth="1.6" />
              <circle cx={x} cy={y} r="10" fill="none" stroke="var(--vela-polar-reference)" strokeWidth="1.5" />
              <circle cx={x} cy={y} r="3" fill="#fff4da" />
              <path d="M24 369h64m-64-4v8m64-8v8" stroke="#c2ccdc" fill="none" />
              <text x="24" y="354" fill="#c2ccdc" fontSize="14">2′</text>
            </svg>
            <figcaption><span><i /> Reference star</span><span><i /> Alignment target</span></figcaption>
          </figure>

          <div className="vela-polar-actions">
            <p>{phase === 'finished' ? 'Your final measurement is kept here for reference.' : phase === 'stopped' ? 'Reposition the rig, then measure a fresh baseline before adjusting again.' : busy ? 'Your last readings stay visible while Vela works on the next measurement.' : 'Adjust the mount’s knobs. Use the reticle and remaining error to decide when you’re done.'}</p>
            {inactive ? (
              <Button tone="neutral" size="large" onClick={() => changePhase('setup')}>Measure again</Button>
            ) : (
              <div><Button tone="neutral" size="large" onClick={() => changePhase('stopped')}>Stop to reposition</Button><Button tone="accent" size="large" onClick={() => changePhase('finished')}>Finish alignment</Button></div>
            )}
          </div>
        </div>
        )}
        <footer className="vela-polar-prototype">Workshop prototype · {baseline ? 'illustrative setup · measurement preview is accelerated' : 'illustrative star field and measurements'}</footer>
      </main>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-polar-alignment',
  name: 'Polar alignment · Product example',
  description: 'Phone-first adjustment exploration with directional corrections, total error and a fixed-scale target overlay. Activity, elapsed times and measurement ages are fixed snapshots for design review. Illustrative fixtures only; no camera, plate solver or hardware commands. Start plays an accelerated three-position measurement preview; stop abandons it and restart takes a fresh baseline. Setup values are illustrative, not a final hardware configuration.',
  controls: {
    mode: { type: 'select', label: 'Rig mode', options: ['offline', 'physical'] },
    example: { type: 'select', label: 'Alignment example', options: examples },
    phase: { type: 'select', label: 'Activity', options: phases },
  },
  defaultProps: { mode: 'offline', example: 'near-aligned', phase: 'setup' },
  render: (props, onPropsChange) => <AlignmentPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
