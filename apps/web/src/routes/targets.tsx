import type { TargetPosition, TargetView } from '@vela/model/web'
import { Button, Input } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api } from '../lib/api'
import { isTarget } from '../features/targets/validation'
import { SkyInspection } from '../features/targets/SkyInspection'
import { SurveyField } from '../features/targets/SurveyField'
import { useFraming } from '../features/targets/use-framing'
import { TargetBrowser } from '../features/targets/TargetBrowser'
import { arcminutes, CenteringProgress, FramingStatus } from '../features/targets/CenteringFeedback'
import { FramingExposure } from '../features/targets/FramingExposure'
import './targets.css'

export function Targets() {
  const { rigId = '', targetId } = useParams()

  return (
    <main className="vela-rig-page targets-page">
      {targetId ? (
        <TargetComposition key={`${rigId}/${targetId}`} rigId={rigId} targetId={targetId} />
      ) : (
        <TargetBrowser key={rigId} rigId={rigId} />
      )}
    </main>
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
        .then((next) => {
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
      className="vela-target-back"
      to={{
        pathname: `/rigs/${encodeURIComponent(rigId)}/observe/targets`,
        search: params.toString(),
      }}
    >
      ← Explore the sky
    </Link>
  )

  if (!target)
    return (
      <>
        {back}
        <p role="status">{loadError ? 'Could not load this target.' : 'Loading target…'}</p>
        {loadError && <Button onClick={() => setRetry((r) => r + 1)}>Try again</Button>}
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

  const canExpose =
    framing.canStart && Number.isFinite(exposure) && exposure >= 0.1 && exposure <= 60

  return (
    <>
      <header className="vela-target-heading">
        {back}
        <h1 ref={heading} tabIndex={-1}>
          Frame {target.name}
        </h1>
        <p>
          {target.catalog} · {view?.rigName ?? 'Observe'}
        </p>
      </header>
      <div className="vela-target-layout">
        <section className="vela-target-composition" aria-label="Composition">
          <SurveyField
            target={target}
            desired={position}
            camera={view?.camera ?? null}
            actual={actual}
            locked={locked}
            focalLengthMm={view?.focalLengthMm ?? null}
            onChange={setDesired}
          />
        </section>
        <aside className="vela-target-sidebar">
          <section
            className="vela-target-result"
            data-current={currentMeasurement}
            data-warning={
              offline ||
              commandUnconfirmed ||
              !!error ||
              !!view?.error ||
              view?.captureReadState === 'retrying'
            }
            aria-label="Your composition"
          >
            <div className="vela-target-result__heading">
              <FramingStatus
                view={view}
                checked={checked}
                centering={centering}
                offline={offline}
                pending={pending}
                commandUnconfirmed={commandUnconfirmed}
              />
              {actual && (
                <time dateTime={actual.capturedAt}>
                  {new Date(actual.capturedAt).toLocaleTimeString([], { hour12: false })}
                </time>
              )}
            </div>
            {actual && sameComposition && !adjusting && (
              <div className="vela-target-offset">
                <strong>{arcminutes(actual.offsetArcminutes)}</strong>
                <span>
                  {currentMeasurement
                    ? 'from your desired center'
                    : 'Last solved distance · current framing unmeasured'}
                </span>
              </div>
            )}
            {currentMeasurement && (
              <p>
                The dashed outline shows where the camera is pointing. Centering will move the
                mount.
              </p>
            )}
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
            ) : checked || (matching && view?.canCenter && actual) ? (
              <Button
                tone="accent"
                disabled={!framing.canStart || !view?.canCenter}
                onClick={() => void centerFraming()}
              >
                Center composition
              </Button>
            ) : null}
          </section>
          <FramingExposure
            preview={view?.preview?.targetId === targetId ? view.preview : null}
            compact
          />
          <div className="vela-target-command">
            <div className="vela-target-exposure">
              <label htmlFor="framing-exposure-seconds">Test exposure</label>
              <div className="vela-target-exposure__input">
                <Input
                  id="framing-exposure-seconds"
                  aria-label="Test exposure (seconds)"
                  type="number"
                  min="0.1"
                  max="60"
                  step="0.1"
                  value={seconds}
                  disabled={!!view?.active || pending}
                  onChange={(event) => setSeconds(event.target.value)}
                />
                <span aria-hidden="true">seconds</span>
              </div>
            </div>
            {!view?.active && (
              <>
                {!checked && (
                  <Button tone="accent" disabled={!canExpose} onClick={() => void startFraming()}>
                    Slew & check
                  </Button>
                )}
                <Button disabled={!canExpose} onClick={() => void startFraming('check')}>
                  Check current frame
                </Button>
                <p>Takes a new test exposure without moving the mount.</p>
              </>
            )}
            {checked && (
              <div className="vela-target-continue">
                <Button tone="quiet" disabled={pending} onClick={() => setAdjusting(true)}>
                  Adjust composition
                </Button>
                {!offline && !pending && !commandUnconfirmed && (
                  <Link
                    className="vela-button"
                    to={`/rigs/${encodeURIComponent(rigId)}/observe?target=${encodeURIComponent(targetId)}`}
                  >
                    Continue to capture →
                  </Link>
                )}
              </div>
            )}
            {actual && !checked && !view?.active && (
              <p>
                This is the last solved exposure. Run a new framing check before continuing to
                capture.
              </p>
            )}
            {(offline || commandUnconfirmed || error) && (
              <Button
                tone="quiet"
                disabled={pending || framing.refreshing}
                onClick={refreshFraming}
              >
                Check rig state
              </Button>
            )}
          </div>
        </aside>
      </div>
      <footer className="vela-target-context">
        <span>
          {view
            ? `State checked ${new Date(view.observedAt).toLocaleTimeString([], { hour12: false })}`
            : 'Reading rig state'}
        </span>
        <span>
          {target.kind}
          {target.sizeArcminutes !== null ? ` · ${target.sizeArcminutes}′ across` : ''}
        </span>
      </footer>
      <div className="vela-target-supplementary">
        <details className="vela-target-measurements">
          <summary>Framing details & state</summary>
          <dl className="vela-target-details">
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
          {actual && (
            <p>
              Test exposure {new Date(actual.capturedAt).toLocaleTimeString([], { hour12: false })}.
              {!sameComposition || adjusting ? ' Measured against the previous composition.' : ''}
            </p>
          )}
          <p>
            Automatic centering uses a fresh solve after each correction, to within 0.5′. At most
            four corrections; stop after two worsening results.
          </p>
          {centering && <CenteringProgress centering={centering} current={currentMeasurement} />}
          {!offline && !commandUnconfirmed && !error && (
            <Button tone="quiet" disabled={pending || framing.refreshing} onClick={refreshFraming}>
              Check rig state
            </Button>
          )}
        </details>
        <details className="vela-target-settings" open={!view?.focalLengthMm}>
          <summary>Optics settings</summary>
          <Input
            label="Effective focal length (mm)"
            type="number"
            min="10"
            max="20000"
            value={focalLength}
            disabled={settingsLocked}
            onChange={(event) => setFocalLength(event.target.value)}
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
        <details id="sky" className="vela-target-sky-context">
          <summary>Through the night</summary>
          <SkyInspection sky={target.sky} targetName={target.name} stale={skyStale} />
        </details>
      </div>
    </>
  )
}
