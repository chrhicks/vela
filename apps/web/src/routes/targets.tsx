import type { TargetPosition, TargetView } from '@vela/model/web'
import { Badge, Button, Input, Panel } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../lib/api'
import { isTarget } from '../features/targets/validation'
import { SkyInspection } from '../features/targets/SkyInspection'
import { SurveyField } from '../features/targets/SurveyField'
import { useFraming } from '../features/targets/use-framing'
import { TargetBrowser } from '../features/targets/TargetBrowser'
import { arcminutes, CenteringProgress, FramingStatus } from '../features/targets/CenteringFeedback'
import './targets.css'

export function Targets() {
  const { rigId = '', targetId } = useParams()

  return (
    <section className="vela-rig-page">
      <Link className="vela-rig-page__back" to={`/rigs/${encodeURIComponent(rigId)}/observe`}>
        ← Observe
      </Link>
      <article className="vela-target-demo">
        <main className="vela-target-main">
          {targetId ? (
            <TargetComposition key={`${rigId}/${targetId}`} rigId={rigId} targetId={targetId} />
          ) : (
            <TargetBrowser key={rigId} rigId={rigId} />
          )}
        </main>
      </article>
    </section>
  )
}

function TargetComposition({ rigId, targetId }: { rigId: string; targetId: string }) {
  const [params] = useSearchParams()
  const [target, setTarget] = useState<TargetView | null>(null)
  const [skyStale, setSkyStale] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [desired, setDesired] = useState<TargetPosition | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [focalLength, setFocalLength] = useState('')
  const [seconds, setSeconds] = useState('2')
  const framing = useFraming(rigId)
  const { view, offline, pending, error, commandUnconfirmed } = framing
  const initialized = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    setLoadError(false)

    const fetchTarget = () =>
      api(`web/rigs/${encodeURIComponent(rigId)}/targets/${encodeURIComponent(targetId)}`, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      })
        .then(next => {
          if (!isTarget(next) || next.id !== targetId) throw new Error('Invalid target response')

          if (!controller.signal.aborted) {
            setTarget(next)
            setSkyStale(false)
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setLoadError(true)
            setSkyStale(true)
          }
        })

    void fetchTarget()
    const timer = setInterval(() => void fetchTarget(), 60000)

    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [rigId, targetId, retry])
  useEffect(() => {
    if (!view || !target || initialized.current) return
    initialized.current = true
    setDesired(view.targetId === targetId && view.desired ? view.desired : target)
    setFocalLength(view.focalLengthMm?.toString() ?? '')
    setSeconds(String(view.exposureSeconds))
    heading.current?.focus()
  }, [view, target, targetId])

  const back = (
    <Link
      className="vela-target-back vela-button"
      to={{
        pathname: `/rigs/${encodeURIComponent(rigId)}/observe/targets`,
        search: params.toString(),
      }}
    >
      ← Targets
    </Link>
  )

  if (!target)
    return (
      <>
        {back}
        <p role="status">{loadError ? 'Could not load this target.' : 'Loading target…'}</p>
        {loadError && <Button onClick={() => setRetry(r => r + 1)}>Try again</Button>}
      </>
    )
  const matching = view?.targetId === targetId
  const position = desired ?? target

  const sameComposition =
    matching &&
    view?.desired?.raDegrees === position.raDegrees &&
    view.desired.decDegrees === position.decDegrees

  const checked = sameComposition && view?.phase === 'checked' && view.checkCurrent && !adjusting
  const locked = !!view?.active || pending || checked
  const settingsLocked = locked || offline || commandUnconfirmed
  const actual = matching ? (view?.actual ?? null) : null
  const centering = sameComposition && !adjusting ? (view?.centering ?? null) : null
  const currentMeasurement = checked && !offline && !commandUnconfirmed && !pending

  const exposure = Number(seconds)
  const focal = Number(focalLength)

  async function startFraming(action: 'start' | 'check' = 'start') {
    const accepted = await framing[action]({ targetId, ...position, exposureSeconds: exposure })

    if (
      accepted?.targetId === targetId &&
      accepted.desired?.raDegrees === position.raDegrees &&
      accepted.desired.decDegrees === position.decDegrees &&
      (accepted.active || (accepted.phase === 'checked' && accepted.checkCurrent))
    ) {
      setAdjusting(false)
    }
  }

  async function centerFraming() {
    const accepted = await framing.center(position)

    if (
      accepted?.targetId === targetId &&
      accepted.desired?.raDegrees === position.raDegrees &&
      accepted.desired.decDegrees === position.decDegrees &&
      (accepted.active || (accepted.phase === 'checked' && accepted.checkCurrent))
    ) {
      setAdjusting(false)
    }
  }

  async function refreshFraming() {
    const current = await framing.refresh()

    if (
      current?.targetId === targetId &&
      current.desired?.raDegrees === position.raDegrees &&
      current.desired.decDegrees === position.decDegrees &&
      (current.active || (current.phase === 'checked' && current.checkCurrent))
    ) {
      setAdjusting(false)
    }
  }

  return (
    <>
      {back}
      <header className="vela-target-heading">
        <div>
          <p>{view?.rigName ?? 'Observe'} / Targets</p>
          <div className="vela-target-identity">
            <h1 ref={heading} tabIndex={-1}>
              {target.name}
            </h1>
            <Badge>{target.catalog}</Badge>
          </div>
        </div>
      </header>
      <div className="vela-target-layout">
        <section className="vela-target-composition" aria-label="Composition">
          <header>
            <strong>{checked ? 'Check the framing' : 'Compose your image'}</strong>
            <span>
              {view?.active || pending
                ? 'Framing in progress · editing paused'
                : checked
                  ? 'Choose Adjust composition to edit'
                  : actual
                    ? 'Solid: desired · dashed: last solved exposure'
                    : 'Drag the frame to reposition'}
            </span>
          </header>
          <SurveyField
            target={target}
            desired={position}
            camera={view?.camera ?? null}
            actual={actual}
            locked={locked}
            onChange={setDesired}
          />
        </section>
        <aside className="vela-target-sidebar">
          <Panel title="Your composition">
            <FramingStatus
              view={view}
              checked={checked}
              centering={centering}
              offline={offline}
              pending={pending}
              commandUnconfirmed={commandUnconfirmed}
            />
            {actual && sameComposition && !adjusting && (
              <div className="vela-target-offset">
                <span>
                  {currentMeasurement
                    ? 'Measured distance from center'
                    : 'Last solved distance · current framing unmeasured'}
                </span>
                <strong>{arcminutes(actual.offsetArcminutes)}</strong>
                {centering && (
                  <span>
                    {centering.measurements[0] &&
                      `Started at ${arcminutes(centering.measurements[0].offsetArcminutes)} · `}
                    goal ≤ {arcminutes(centering.toleranceArcminutes)}
                  </span>
                )}
              </div>
            )}
            <dl className="vela-target-facts">
              <div>
                <dt>Exposure</dt>
                <dd>{view?.exposureSeconds ?? seconds} s</dd>
              </div>
              <div>
                <dt>Mount pointing side</dt>
                <dd>
                  {offline ? 'Last known: ' : ''}
                  {
                    { east: 'East', west: 'West', unknown: 'Unknown' }[
                      view?.pointingSide ?? 'unknown'
                    ]
                  }
                </dd>
              </div>
            </dl>
            <div className="vela-target-command">
              {view?.error && <p role="alert">{view.error}</p>}
              {error && <p role="alert">{error}</p>}
              {view?.unavailableReason && <p>{view.unavailableReason}</p>}
              {view?.active && !matching && (
                <p>A framing check for another target is active on this rig.</p>
              )}
              {view?.active ? (
                <Button disabled={!framing.canStop} onClick={() => void framing.stop()}>
                  Stop framing
                </Button>
              ) : checked ? (
                <>
                  <Button
                    tone="accent"
                    disabled={!framing.canStart || !view.canCenter}
                    onClick={() => void centerFraming()}
                  >
                    Center composition
                  </Button>
                  <p>
                    Automatically refine to within 0.5′, using a fresh solve after each correction.
                    At most four corrections; stop after two worsening results.
                  </p>
                  <Button disabled={pending} onClick={() => setAdjusting(true)}>
                    Adjust composition
                  </Button>
                  {!offline && !pending && !commandUnconfirmed && (
                    <Link
                      className="vela-button vela-button--accent"
                      to={`/rigs/${encodeURIComponent(rigId)}/observe/capture`}
                    >
                      Continue to capture →
                    </Link>
                  )}
                </>
              ) : (
                <>
                  {matching && view?.canCenter && actual && (
                    <>
                      <Button
                        tone="accent"
                        disabled={!framing.canStart}
                        onClick={() => void centerFraming()}
                      >
                        Center composition
                      </Button>
                      <p>
                        Automatically center your edited composition, measuring after every
                        correction.
                      </p>
                    </>
                  )}
                  <Input
                    label="Test exposure (seconds)"
                    type="number"
                    min="0.1"
                    max="60"
                    step="0.1"
                    value={seconds}
                    disabled={locked}
                    onChange={e => setSeconds(e.target.value)}
                  />
                  <Button
                    tone="accent"
                    disabled={
                      !framing.canStart ||
                      !Number.isFinite(exposure) ||
                      exposure < 0.1 ||
                      exposure > 60
                    }
                    onClick={() => void startFraming()}
                  >
                    Slew & check
                  </Button>
                </>
              )}
              {!view?.active && (
                <>
                  <Button
                    disabled={
                      !framing.canStart ||
                      !Number.isFinite(exposure) ||
                      exposure < 0.1 ||
                      exposure > 60
                    }
                    onClick={() => void startFraming('check')}
                  >
                    Check current frame
                  </Button>
                  <p>Take a test exposure at the current position without moving the mount.</p>
                </>
              )}
              {view && <p>State checked {new Date(view.observedAt).toLocaleTimeString()}</p>}
              {actual && !checked && !view?.active && (
                <p>
                  This is the last solved exposure. Run a new framing check before continuing to
                  capture.
                </p>
              )}
              {actual && (
                <p>
                  Test exposure {new Date(actual.capturedAt).toLocaleTimeString()}.
                  {!sameComposition || adjusting
                    ? ' Measured against the previous composition.'
                    : ''}
                </p>
              )}
              <Button
                tone="quiet"
                disabled={pending || framing.refreshing}
                onClick={refreshFraming}
              >
                Check rig state
              </Button>
            </div>
            <p className="vela-target-description">
              {target.kind}
              {target.sizeArcminutes !== null ? ` · ${target.sizeArcminutes}′ across` : ''}
            </p>
            <dl className="vela-target-details">
              <div>
                <dt>Camera</dt>
                <dd>{view?.camera?.name ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Orientation</dt>
                <dd>
                  {actual
                    ? `${actual.rotationDegrees.toFixed(1)}° last measured`
                    : 'Assumed north-up · not measured'}
                </dd>
              </div>
              <div>
                <dt>Center (J2000)</dt>
                <dd>
                  {position.raDegrees.toFixed(4)}°, {position.decDegrees.toFixed(4)}°
                </dd>
              </div>
              {view?.camera && (
                <div>
                  <dt>Field of view</dt>
                  <dd>
                    {view.camera.fieldWidthDegrees.toFixed(2)}° ×{' '}
                    {view.camera.fieldHeightDegrees.toFixed(2)}°
                  </dd>
                </div>
              )}
            </dl>
            <details className="vela-target-settings" open={!view?.focalLengthMm}>
              <summary>Optics settings</summary>
              <Input
                label="Effective focal length (mm)"
                type="number"
                min="10"
                max="20000"
                value={focalLength}
                disabled={settingsLocked}
                onChange={e => setFocalLength(e.target.value)}
              />
              <Button
                disabled={
                  settingsLocked || !view || !Number.isFinite(focal) || focal < 10 || focal > 20000
                }
                onClick={() => void framing.settings(focal)}
              >
                Save focal length
              </Button>
            </details>
          </Panel>
        </aside>
        {centering && <CenteringProgress centering={centering} current={currentMeasurement} />}
        <div className="vela-target-sky-context">
          <SkyInspection sky={target.sky} targetName={target.name} stale={skyStale} />
        </div>
      </div>
    </>
  )
}
