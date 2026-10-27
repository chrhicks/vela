import type { CaptureView, FrameType } from '@vela/model/web'
import { Button, Checkbox, Input, Select } from '@vela/ui'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CaptureInterruption } from '../features/capture/CaptureInterruption'
import { LatestImage } from '../features/capture/LatestImage'
import { captureActivity, useCapture } from '../features/capture/use-capture'
import { carriesFilter, frameTypeChoices, frameTypes, isCalibration } from '../features/capture/frame-types'
import { filterLabel, listedFilter, rememberedFilter, rememberFilter } from '../features/capture/filter-choice'
import { MAX_FRAME_COUNT, parseFrameCount } from '../features/capture/validation'
import { pagingLabel } from '../features/alerts/presentation'
import { useRigObservation } from '../features/rig-detail/RigContext'
import { useTonightTarget } from '../features/targets/use-tonight-target'
import { AltitudeTrace } from '../features/targets/AltitudeTrace'
import { skyTime } from '../features/targets/sky-time'
import { EquipmentSummary } from '../features/observation/EquipmentSummary'
import './capture.css'

export function Capture() {
  const { rigId = '' } = useParams()

  return <CapturePage key={rigId} rigId={rigId} />
}

function CapturePage({ rigId }: { rigId: string }) {
  const capture = useCapture(rigId)
  const rig = useRigObservation()
  const [params] = useSearchParams()
  const [exposure, setExposure] = useState<string | null>(null)
  const [saveFrames, setSaveFrames] = useState<boolean | null>(null)
  const [repeat, setRepeat] = useState<boolean | null>(null)
  const [frames, setFrames] = useState('')
  // Never carried over: every new run starts with the phone off.
  const [unattended, setUnattended] = useState(false)
  // Always light until chosen: a calibration run has no target, so it is never the carried-over default.
  const [chosenFrameType, setChosenFrameType] = useState<FrameType>('light')
  // Remembered for each rig: the filter rarely changes between nights, and the slot is manual.
  const [chosenFilter, setChosenFilter] = useState(() => rememberedFilter(rigId))
  const { view, offline, pending, refreshing, error, commandUnconfirmed } = capture
  const chosenTargetId = params.get('target') ?? undefined

  // A run that begins, from this page or another, uses up the choice: the next form starts with the phone off.
  useEffect(() => {
    if (view?.active) setUnattended(false)
  }, [view?.active])

  const targetId = view?.active
    ? view.subject?.targetId
    : (chosenTargetId ?? view?.subject?.targetId)

  const { target, stale: skyStale } = useTonightTarget(rigId, targetId)

  const subject = view?.active
    ? view.subject
    : chosenTargetId
      ? target
      : (target ?? view?.subject)

  const base = `/rigs/${encodeURIComponent(rigId)}`

  const exposureValue = view?.active
    ? String(view.exposureSeconds)
    : (exposure ?? String(view?.exposureSeconds ?? 2))

  const repeating = view?.active ? view.repeat : (repeat ?? view?.repeat ?? true)
  // Saved by default: an unsaved frame past the last three is gone, and a night's frames cannot be retaken.
  const savingFrames = view?.active ? view.saveFrames : (saveFrames ?? true)
  const frameType = view?.active ? view.frameType : chosenFrameType
  const calibration = isCalibration(frameType)
  const filters = view?.filters ?? []
  const filter = listedFilter(chosenFilter, filters)
  const filterChoosable = carriesFilter(frameType) && filters.length > 0
  const seconds = Number(exposureValue)
  const frameCount = parseFrameCount(frames)

  const validExposure =
    exposureValue.trim() !== '' && Number.isFinite(seconds) && seconds >= 0.1 && seconds <= 600

  if (!view)
    return (
      <section className="vela-rig-page capture-page">
        <h1 className="vela-type-page">Tonight</h1>
        <p role="status">
          {offline
            ? (error ??
              'Capture state is unavailable. Check that the Vela server is reachable.')
            : 'Loading capture state…'}
        </p>
        {offline && (
          <Button disabled={refreshing} onClick={() => void capture.refresh()}>
            Check capture state
          </Button>
        )}
        <Link className="tonight-link" to={`${base}/observe`}>
          Prepare your rig
        </Link>
      </section>
    )

  const busy = view.active || pending
  const retrying = view.captureReadState === 'retrying'
  const interrupted = offline || commandUnconfirmed || retrying

  const activity = pending
    ? 'Sending command'
    : commandUnconfirmed
      ? 'Command outcome unknown'
      : captureActivity(view, offline)

  const showProgress = view.phase === 'exposing' && !interrupted && !pending

  const warning =
    error ??
    (offline
      ? 'Capture status is unknown. Waiting for the rig to reconnect.'
      : (view.error ??
        view.unavailableReason ??
        (retrying
          ? `The server is connected, but camera reads are interrupted. Retrying reads for exposure ${view.completedCount + 1}; no new exposure will start while waiting.`
          : null)))

  const remaining = Math.max(0, Math.ceil(view.exposureSeconds - view.elapsedSeconds))

  const countdown = `${Math.floor(remaining / 60)
    .toString()
    .padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`

  const telescope = rig?.view?.devices.find(device => device.kind === 'telescope')

  const tracking =
    !rig?.interrupted &&
    telescope?.connection === 'connected' &&
    (telescope.status.availability === 'complete' ||
      telescope.status.availability === 'partial')
      ? telescope.status.tracking
      : 'unknown'

  const sky = target?.sky

  const direction = sky
    ? [
        'Northern',
        'Northeastern',
        'Eastern',
        'Southeastern',
        'Southern',
        'Southwestern',
        'Western',
        'Northwestern',
      ][Math.round(sky.currentAzimuthDegrees / 45) % 8]
    : null

  const hasPendingChoice =
    view.active && !calibration && chosenTargetId && chosenTargetId !== view.subject?.targetId

  return (
    <section className="vela-rig-page capture-page" aria-label="Tonight" data-interrupted={offline || undefined}>
      <div className="capture-page__layout">
        <LatestImage
          fieldroom
          rigId={rigId}
          image={view.latestImage}
          busy={busy}
          interrupted={interrupted || !view.enabled}
        />
        <aside className="tonight-context">
          <section className="tonight-subject" aria-label="Your subject">
            <div className="tonight-context__heading">
              <span>Your subject</span>
              <Link className="tonight-link" to={`${base}/observe/targets`}>
                Change target
              </Link>
            </div>
            <h1 className="vela-type-subject">
              {calibration
                ? frameTypeChoices[frameType].frames
                : (subject?.name ?? (chosenTargetId ? 'Selected subject' : 'Choose your subject'))}
            </h1>
            <p>
              {calibration
                ? 'Calibration frames are not tied to a target.'
                : [subject?.catalog, target?.constellation, target?.kind]
                    .filter(Boolean)
                    .join(' · ') || 'Explore the sky, or capture at the current position.'}
            </p>
            {hasPendingChoice && (
              <p>
                Another target is selected for the next run. This run keeps its original
                subject.
              </p>
            )}
          </section>
          {offline ? (
            <CaptureInterruption
              view={view}
              interruptedAt={capture.interruptedAt}
              warning={warning}
            />
          ) : (
            <section
              className="tonight-capture"
              data-active={(view.active && !interrupted) || undefined}
              aria-label="Capture images"
            >
              {warning && !offline && (
                <div className="capture-page__warning" role="status">
                  <strong>
                    {commandUnconfirmed
                      ? 'Command outcome unknown'
                      : offline
                        ? 'Connection interrupted'
                        : view.phase === 'failed'
                          ? 'Capture stopped'
                          : retrying
                            ? 'Camera observation interrupted'
                            : 'Capture unavailable'}
                  </strong>
                  <p>
                    {warning}
                    {view.latestImage ? ' The last image is kept below.' : ''}
                  </p>
                  {commandUnconfirmed && (
                    <Button
                      disabled={pending || refreshing}
                      onClick={() => void capture.refresh()}
                    >
                      {refreshing ? 'Checking capture state…' : 'Check capture state'}
                    </Button>
                  )}
                </div>
              )}
              <div className="tonight-capture__heading">
                <strong role="status">
                  {showProgress ? <><span className="tonight-capture__dot" aria-hidden="true" />Capturing</> : activity}
                </strong>
                {view.active && (
                  <span>
                    {calibration && `${frameTypeChoices[frameType].label} · `}
                    {view.filter && `${view.filter} · `}Exposure{' '}
                    {view.completedCount + 1}
                  </span>
                )}
              </div>
              {view.active ? (
                <>
                  <div className="tonight-capture__remaining">
                    <span className="vela-type-metric">{showProgress ? countdown : '—'}</span>
                    <span>
                      {showProgress
                        ? 'left in this exposure'
                        : interrupted
                          ? 'Progress unavailable'
                          : activity}
                    </span>
                  </div>
                  {showProgress ? (
                    <progress
                      value={Math.min(1, view.elapsedSeconds / view.exposureSeconds)}
                      max="1"
                      aria-label="Exposure progress"
                    />
                  ) : (
                    <p className="tonight-capture__explanation">
                      {retrying
                        ? 'No new exposure starts while camera reads retry. You can stop while waiting.'
                        : view.phase === 'saving'
                          ? 'Saving this image before the next exposure. Stop waits for this save to finish.'
                          : view.phase === 'stopping'
                            ? 'Waiting for the camera to confirm it has stopped.'
                            : interrupted
                              ? 'Current activity cannot be confirmed. The last completed image is kept.'
                              : 'Receiving the completed exposure.'}
                    </p>
                  )}
                  <p className="tonight-capture__paging">{pagingLabel(view.unattended)}</p>
                  <div className="tonight-capture__actions">
                    <div>
                      {view.savedCount} saved · {integrationTime(view.integrationSeconds)}{' '}
                      collected
                      {(view.lostFrameCount ?? 0) > 0 && <> · {view.lostFrameCount} lost</>}
                      <br />
                      {view.frameCount
                        ? `${view.completedCount} of ${view.frameCount} frames`
                        : view.repeat
                          ? 'Repeats until you stop'
                          : 'One exposure'}
                    </div>
                    <Button
                      tone="accent"
                      leadingIcon={<span aria-hidden="true" className="tonight-stop-mark" />}
                      disabled={!capture.canStop}
                      onClick={() => void capture.stop()}
                    >
                      {pending
                        ? 'Sending command…'
                        : view.phase === 'stopping'
                          ? 'Stopping capture…'
                          : 'Stop capture'}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {view.interruption && (
                    <div
                      className="capture-page__warning"
                      role="status"
                      aria-label="Interrupted capture run"
                    >
                      <p>
                        {view.interruption.reason} during this run, and nothing has been exposed
                        since. {interruptedProgress(view)}
                      </p>
                      {view.unattended && (
                        <p>Resume keeps Unattended on: the phone is paged for the resumed run.</p>
                      )}
                      {view.interruption.remainingCount === 0 ? (
                        <p>It had taken all its frames.</p>
                      ) : (
                        <Button
                          tone="accent"
                          disabled={!capture.canResume}
                          onClick={() => void capture.resume()}
                        >
                          {pending
                            ? 'Sending command…'
                            : view.interruption.remainingCount === null
                              ? 'Resume · repeat until stopped'
                              : `Resume · ${view.interruption.remainingCount} ${view.interruption.remainingCount === 1 ? 'frame' : 'frames'} left`}
                        </Button>
                      )}
                    </div>
                  )}
                  {view.completedCount > 0 && (
                    <p>
                      {view.savedCount} saved · {integrationTime(view.integrationSeconds)}{' '}
                      collected · {view.completedCount} completed
                      {(view.lostFrameCount ?? 0) > 0 && <> · {view.lostFrameCount} lost</>}
                    </p>
                  )}
                  <form
                    onSubmit={event => {
                      event.preventDefault()

                      if (validExposure && (!repeating || frameCount.valid))
                        void capture.start({
                          seconds,
                          repeat: repeating,
                          saveFrames: savingFrames,
                          frameType,
                          unattended,
                          targetId: calibration
                            ? undefined
                            : (chosenTargetId ?? view.subject?.targetId),
                          filter: filterChoosable ? (filter ?? undefined) : undefined,
                          frameCount: repeating ? frameCount.frameCount : undefined,
                        })
                    }}
                  >
                    <Select
                      label="Frame type"
                      value={frameType}
                      options={frameTypes.map(value => ({
                        value,
                        label: frameTypeChoices[value].label,
                      }))}
                      message={frameTypeChoices[frameType].reminder ?? ''}
                      disabled={busy || offline}
                      onChange={event => {
                        const next = frameTypes.find(value => value === event.target.value)

                        if (next) setChosenFrameType(next)
                      }}
                    />
                    {filterChoosable && (
                      <Select
                        label="Filter"
                        value={filter ?? ''}
                        options={[
                          { value: '', label: 'None' },
                          ...filters.map(listed => ({
                            value: listed.name,
                            label: filterLabel(listed),
                          })),
                        ]}
                        message="Choose the filter that is in the camera now. Vela cannot see it."
                        disabled={busy || offline}
                        onChange={event => {
                          const next = listedFilter(event.target.value, filters)

                          setChosenFilter(next)
                          rememberFilter(rigId, next)
                        }}
                      />
                    )}
                    <Input
                      label="Exposure · seconds"
                      type="number"
                      min="0.1"
                      max="600"
                      step="0.1"
                      value={exposureValue}
                      disabled={busy || offline}
                      invalid={!validExposure}
                      message={validExposure ? '' : 'Choose 0.1–600 seconds.'}
                      onChange={event => setExposure(event.target.value)}
                    />
                    <Checkbox
                      label="Repeat until stopped"
                      checked={repeating}
                      disabled={busy || offline}
                      onChange={event => setRepeat(event.target.checked)}
                    />
                    <Input
                      label="Frames · optional"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max={MAX_FRAME_COUNT}
                      step="1"
                      placeholder="Until stopped"
                      value={frames}
                      disabled={busy || offline || !repeating}
                      invalid={repeating && !frameCount.valid}
                      message={
                        repeating && !frameCount.valid
                          ? `Choose a whole number from 1 to ${MAX_FRAME_COUNT}, or leave blank.`
                          : ''
                      }
                      onChange={event => setFrames(event.target.value)}
                    />
                    <Checkbox
                      label="Save frames"
                      description="Keep every completed image as FITS + preview."
                      checked={savingFrames}
                      disabled={busy || offline}
                      onChange={event => setSaveFrames(event.target.checked)}
                    />
                    <Checkbox
                      label="Unattended (page my phone)"
                      description="Alerts always show here. Your phone is paged only while this is on."
                      checked={unattended}
                      disabled={busy || offline}
                      onChange={event => setUnattended(event.target.checked)}
                    />
                    <Button
                      type="submit"
                      tone="accent"
                      disabled={
                        !capture.canStart ||
                        !validExposure ||
                        (repeating && !frameCount.valid) ||
                        (!calibration && !!chosenTargetId && !target)
                      }
                    >
                      {pending
                        ? 'Sending command…'
                        : repeating
                          ? 'Start capture'
                          : 'Take exposure'}
                    </Button>
                  </form>
                  {!view.enabled && (
                    <Link className="tonight-link" to={`${base}/observe`}>
                      Prepare your rig
                    </Link>
                  )}
                </>
              )}
            </section>
          )}
          <section className="tonight-sky" aria-label="In your sky">
            <div className="tonight-context__heading">
              <strong>In your sky</strong>
              {target && (
                <Link
                  className="tonight-link"
                  to={`${base}/observe/targets/${encodeURIComponent(target.id)}#sky`}
                >
                  Open sky view
                </Link>
              )}
            </div>
            {sky ? (
              <>
                <div className="tonight-sky__position">
                  <div className="tonight-sky__altitude">
                    <span className="vela-type-metric">
                      {Math.round(sky.currentAltitudeDegrees)}°
                    </span>
                    <span>
                      {sky.currentAltitudeDegrees >= 0
                        ? 'Above the horizon'
                        : 'Below the horizon'}
                    </span>
                    <p>
                      {direction} sky
                      <br />
                      {
                        {
                          on: 'Mount tracking',
                          off: 'Mount not tracking',
                          unknown: 'Tracking unconfirmed',
                        }[tracking]
                      }
                    </p>
                  </div>
                  <AltitudeTrace sky={sky} stale={skyStale} />
                </div>
                <div className="tonight-sky__facts">
                  <span>Distance unavailable</span>
                  <span>
                    {skyStale ? 'Last calculation' : 'Calculated'} {skyTime(sky.observedAt)}
                  </span>
                </div>
                {skyStale && (
                  <p role="status">Sky updates interrupted · last calculation shown.</p>
                )}
              </>
            ) : (
              <p>
                {targetId
                  ? skyStale
                    ? 'Sky calculation unavailable. Retrying quietly.'
                    : target
                      ? 'Site unavailable · sky path unknown'
                      : 'Loading sky context…'
                  : 'Choose a target to see its path through your sky.'}
              </p>
            )}
          </section>
        </aside>
      </div>
      <EquipmentSummary
        rigName={view.rigName}
        rigId={rigId}
        cooling={view.cooling}
        coolingStale={offline || capture.coolingUnconfirmed}
      />
    </section>
  )
}

function interruptedProgress(view: CaptureView) {
  const taken = view.frameCount
    ? `${view.completedCount} of ${view.frameCount} frames taken`
    : `${view.completedCount} ${view.completedCount === 1 ? 'frame' : 'frames'} taken`

  const what = view.frameType === 'light' ? (view.subject?.name ?? 'Light frames') : frameTypeChoices[view.frameType].frames

  return `${what} · ${taken} · ${view.exposureSeconds} s each.`
}

function integrationTime(seconds: number) {
  return seconds >= 60 ? `${Number((seconds / 60).toFixed(1))} min` : `${seconds} s`
}
