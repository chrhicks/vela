import { useEffect, useState } from 'react'
import type { ComponentSpecimen } from '../themes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Panel } from './Panel'
import {
  AlignmentImageInspection,
  alignmentInspectionFixtures,
} from './Panel.polar-alignment-inspection'
import './Panel.polar-alignment.specimen.css'

const examples = ['large-error', 'near-aligned', 'outside-image'] as const

const phases = [
  'setup',
  'point-1',
  'moving-2',
  'point-2',
  'moving-3',
  'point-3',
  'baseline-no-solution',
  'baseline-stopped',
  'adjusting',
  'exposing',
  'debayering',
  'stretching',
  'solving',
  'retrying',
  'reconnecting',
  'stopped',
  'finished',
] as const

const activityFrames = new Map<string, { label: string; age: string }>(
  Object.entries({
    adjusting: { label: 'Alignment updated', age: 'Just now' },
    exposing: { label: 'Exposing image', age: '7 s ago' },
    waiting: { label: 'Exposing image', age: '7 s ago' },
    debayering: { label: 'Debayering image…', age: '32 s ago' },
    stretching: { label: 'Stretching image…', age: '33 s ago' },
    solving: { label: 'Plate-solving…', age: '35 s ago' },
    retrying: { label: 'Exposing another image', age: '1 min 7 s ago' },
    reconnecting: { label: 'Device connection interrupted · Retrying…', age: '1 min 7 s ago' },
    stopped: { label: 'Measurements stopped', age: 'At stop · 35 s old' },
    finished: { label: 'Alignment ended by you', age: 'At finish · 2 s old' },
  }),
)

const measurementSteps = new Map<
  string,
  {
    point: number
    solved: number
    label: string
    next: string
  }
>(
  Object.entries({
    'point-1': {
      point: 1,
      solved: 0,
      label: 'Taking and solving the first image…',
      next: 'moving-2',
    },
    'moving-2': {
      point: 2,
      solved: 1,
      label: 'Moving to the second position…',
      next: 'point-2',
    },
    'point-2': {
      point: 2,
      solved: 1,
      label: 'Taking and solving the second image…',
      next: 'moving-3',
    },
    'moving-3': {
      point: 3,
      solved: 2,
      label: 'Moving to the third position…',
      next: 'point-3',
    },
    'point-3': {
      point: 3,
      solved: 2,
      label: 'Taking and solving the final image…',
      next: 'adjusting',
    },
    'baseline-no-solution': {
      point: 1,
      solved: 0,
      label: 'No solution for this exposure · Trying another image',
      next: 'point-1',
    },
  }),
)

function BaselinePreview({
  phase,
  physical,
  onStart,
  onStop,
}: {
  readonly phase: string
  readonly physical: boolean
  readonly onStart: () => void
  readonly onStop: () => void
}) {
  const step = measurementSteps.get(phase)
  const stopped = phase === 'baseline-stopped'

  return (
    <div className="vela-polar-baseline">
      <Panel className="vela-polar-baseline__summary">
        <h2>
          {step
            ? 'Measuring your alignment'
            : stopped
              ? 'Measurement stopped'
              : 'Find your starting alignment'}
        </h2>
        <p>
          {step
            ? 'Keep the mount’s adjustment knobs still while Vela measures three positions.'
            : stopped
              ? 'No alignment result was calculated. Start again when you’re ready for a fresh set of measurements.'
              : 'Vela will take and solve images at three positions, then show you how to adjust the mount.'}
        </p>
        <ol className="vela-polar-points" aria-label="Three measurement positions">
          {[1, 2, 3].map(point => (
            <li
              key={point}
              data-state={
                step && point <= step.solved
                  ? 'done'
                  : step?.point === point
                    ? 'current'
                    : 'pending'
              }
            >
              <span>{step && point <= step.solved ? '✓' : point}</span>
              <strong>Position {point}</strong>
              <small>
                {step && point <= step.solved
                  ? 'Solved'
                  : step?.point === point
                    ? phase.startsWith('moving')
                      ? 'Moving'
                      : 'Measuring'
                    : 'Not measured'}
              </small>
            </li>
          ))}
        </ol>
        {step ? (
          <div className="vela-polar-activity">
            <div className="vela-polar-activity__line" role="status">
              <span className="vela-polar-activity__spinner" aria-hidden="true" />
              <strong>{step.label}</strong>
            </div>
            <p>{step.solved} of 3 positions solved · Alignment error not yet available</p>
          </div>
        ) : (
          <dl className="vela-polar-setup-facts">
            <div>
              <dt>Camera</dt>
              <dd>{physical ? 'ASI2600MC Pro' : 'Main imaging camera'}</dd>
            </div>
            <div>
              <dt>Exposure</dt>
              <dd>{physical ? '2 seconds' : '30 seconds'}</dd>
            </div>
            <div>
              <dt>Starting point</dt>
              <dd>{physical ? 'Dec +80° · consistent starting field' : 'Current position'}</dd>
            </div>
          </dl>
        )}
        {(step || stopped) && (
          <AlignmentImageInspection
            title={`Latest exposure · Position ${step?.point ?? 1}`}
            status={
              phase === 'baseline-no-solution'
                ? 'No solution · Exposure retained for inspection. No alignment result yet.'
                : 'No alignment result yet'
            }
          />
        )}
      </Panel>
      <div className="vela-polar-baseline__next">
        <h3>{step ? 'What happens next' : 'Before you start'}</h3>
        <p>
          {step
            ? 'After the third solve, the adjustment view will show your alignment error and the target reticle.'
            : physical
              ? 'Each attempt homes, then moves to a consistent starting field at Dec +80°. Prepare a clear movement corridor: after a small direction check, Vela makes two continuous westward RA rotations of roughly 54° at 1° per second. Allow up to 120° total westward travel and 1° on either side for the direction check.'
              : 'Point toward a clear patch of sky. Starting measurement will move the telescope through three positions along its rotation axis.'}
        </p>
        <p>
          {step
            ? 'You can stop the measurement at any time.'
            : physical
              ? 'Use sidereal tracking. Keep the mount’s adjustment knobs still until all three positions are measured. You can stop at any time.'
              : 'Leave room for the movement, and keep the adjustment knobs still until measurement finishes.'}
        </p>
        <Button size="large" tone={step ? 'neutral' : 'accent'} onClick={step ? onStop : onStart}>
          {step ? 'Stop measurement' : stopped ? 'Start again' : 'Start measurement'}
        </Button>
      </div>
    </div>
  )
}

function AlignmentPreview({
  props,
  onPropsChange,
}: {
  readonly props: Record<string, string | number | boolean>
  readonly onPropsChange?: (patch: Record<string, string | number | boolean>) => void
}) {
  const [localPhase, setLocalPhase] = useState(String(props.phase ?? 'setup'))
  const [playing, setPlaying] = useState(false)
  const phase = onPropsChange ? String(props.phase) : localPhase
  const baseline = phase === 'setup' || phase === 'baseline-stopped' || measurementSteps.has(phase)
  const example = examples.find(value => value === props.example) ?? 'near-aligned'
  const fixture = alignmentInspectionFixtures[example]
  const inactive = phase === 'stopped' || phase === 'finished'
  const busy = !inactive && phase !== 'adjusting'
  const exposing = phase === 'exposing' || phase === 'waiting' || phase === 'retrying'
  const retrying = phase === 'retrying'
  const reconnecting = phase === 'reconnecting'
  const activity = activityFrames.get(phase) ?? activityFrames.get('adjusting')!

  function changePhase(value: string, play = false) {
    setPlaying(play)

    if (onPropsChange) onPropsChange({ phase: value })
    else setLocalPhase(value)
  }

  useEffect(() => {
    const step = measurementSteps.get(phase)

    if (!playing || !step) return

    const timer = window.setTimeout(() => {
      if (step.next === 'adjusting') setPlaying(false)

      if (onPropsChange) onPropsChange({ phase: step.next })
      else setLocalPhase(step.next)
    }, 1_600)

    return () => window.clearTimeout(timer)
  }, [phase, playing, onPropsChange])

  let status: string

  if (reconnecting) {
    status = 'Reconnecting'
  } else if (baseline) {
    if (measurementSteps.get(phase)) {
      status = 'Measuring'
    } else if (phase === 'baseline-stopped') {
      status = 'Stopped'
    } else {
      status = 'Not started'
    }
  } else if (phase === 'finished') {
    status = 'Finished'
  } else if (phase === 'stopped') {
    status = 'Stopped'
  } else {
    status = busy ? 'Measuring' : 'Adjusting'
  }

  return (
    <article className="vela-polar-demo">
      <header className="vela-polar-shell">
        <strong>Vela</strong>
        <span>Askar FRA 400</span>
        <span>Observe</span>
      </header>
      <main className="vela-polar-main">
        <header className="vela-polar-heading">
          <div>
            <p>Rig preparation</p>
            <h1>Polar alignment</h1>
          </div>
          <Badge tone={reconnecting ? 'warning' : inactive ? 'neutral' : 'accent'}>{status}</Badge>
        </header>
        {(retrying || reconnecting) && (
          <div className="vela-polar-solve-warning" role="alert">
            <strong>
              {reconnecting ? 'Device connection interrupted' : 'Plate-solving failed'}
            </strong>
            <p>
              {reconnecting ? 'Retrying automatically. ' : 'Trying another image. '}Showing the last
              successful solve.
            </p>
          </div>
        )}
        {baseline ? (
          <BaselinePreview
            phase={phase}
            physical={props.mode === 'physical'}
            onStart={() => changePhase('point-1', true)}
            onStop={() => changePhase('baseline-stopped')}
          />
        ) : (
          <div className="vela-polar-layout">
            <Panel className="vela-polar-readings">
              <div className="vela-polar-total">
                <span>{inactive || busy ? 'Last measured error' : 'Total alignment error'}</span>
                <strong>{fixture.total}</strong>
              </div>
              <div className="vela-polar-directions" aria-label="Mount adjustment directions">
                <div>
                  <span>Azimuth · horizontal</span>
                  <strong>→ {fixture.azimuth}</strong>
                  <span>{inactive || busy ? 'Last correction: right' : 'Move right'}</span>
                </div>
                <div>
                  <span>Altitude · vertical</span>
                  <strong>↑ {fixture.altitude}</strong>
                  <span>{inactive || busy ? 'Last correction: up' : 'Move up'}</span>
                </div>
              </div>
              <div className="vela-polar-activity" data-warning={retrying || undefined}>
                <div className="vela-polar-activity__line" role="status">
                  {busy ? (
                    <span className="vela-polar-activity__spinner" aria-hidden="true" />
                  ) : null}
                  <strong>{activity.label}</strong>
                  {exposing ? <span className="vela-polar-activity__time">5 / 30 s</span> : null}
                </div>
                {exposing ? (
                  <progress value={5} max={30} aria-label="Exposure progress in seconds" />
                ) : null}
                <div className="vela-polar-activity__age">
                  <span>Last alignment update</span>
                  <span>{activity.age}</span>
                </div>
                <p>
                  {reconnecting
                    ? 'Readings and overlay are last known. Reconnecting…'
                    : busy
                      ? 'Wait for the next alignment update before adjusting again.'
                      : inactive
                        ? 'Readings and overlay are from the last successful solve.'
                        : 'The readings and overlay are ready for your next adjustment.'}
                </p>
              </div>
            </Panel>

            <AlignmentImageInspection
              key={example}
              target={fixture}
              title={inactive || busy ? 'Last solved frame' : 'Alignment view'}
              status={`${inactive || busy ? 'Last known solve' : 'Latest solve'} · ${activity.age}${retrying || reconnecting ? ' · Retrying; pause adjustments' : ''}`}
            />

            <div className="vela-polar-actions">
              <p>
                {reconnecting
                  ? 'Pause adjustments until a fresh measurement arrives. Vela is keeping your baseline and retrying automatically.'
                  : phase === 'finished'
                    ? 'Your final measurement is kept here for reference.'
                    : phase === 'stopped'
                      ? 'Reposition the rig, then measure a fresh baseline before adjusting again.'
                      : busy
                        ? 'Your last readings stay visible while Vela works on the next measurement.'
                        : 'Adjust the mount’s knobs. Use the reticle and remaining error to decide when you’re done.'}
              </p>
              {inactive ? (
                <Button tone="neutral" size="large" onClick={() => changePhase('setup')}>
                  Measure again
                </Button>
              ) : (
                <div>
                  <Button tone="neutral" size="large" onClick={() => changePhase('stopped')}>
                    Stop to reposition
                  </Button>
                  <Button tone="accent" size="large" onClick={() => changePhase('finished')}>
                    Finish alignment
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        <footer className="vela-polar-prototype">
          {'Workshop prototype · '}
          {baseline
            ? 'illustrative setup · measurement preview is accelerated'
            : 'illustrative star field and measurements'}
        </footer>
      </main>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-polar-alignment',
  name: 'Polar alignment · Product example',
  description:
    'Approved alignment inspection design (September 21): initial fit-both, deliberate fine view, full frame and expanded/native inspection of the same exposure. Illustrative geometry on a bundled simulator image; not a real plate solution or independent accuracy evidence. Ages and retry states are fixed snapshots. Start plays an accelerated three-position preview; no hardware commands.',
  controls: {
    mode: { type: 'select', label: 'Rig mode', options: ['offline', 'physical'] },
    example: { type: 'select', label: 'Alignment example', options: examples },
    phase: { type: 'select', label: 'Activity', options: phases },
  },
  defaultProps: { mode: 'offline', example: 'near-aligned', phase: 'setup' },
  render: (props, onPropsChange) => (
    <AlignmentPreview props={props} {...(onPropsChange ? { onPropsChange } : {})} />
  ),
}
