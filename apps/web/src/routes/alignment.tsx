import { z } from 'zod'
import type { AlignmentView } from '@vela/model/web'
import { Button, Panel } from '@vela/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../lib/api'
import {
  AlignmentImage,
  AlignmentImageDialog,
  type ExpandedAlignmentImage,
} from '../features/alignment/AlignmentImage'
import './alignment.css'

function useAlignment(rigId: string) {
  const [view, setView] = useState<AlignmentView | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const writing = useRef(false)
  const endUnconfirmed = useRef(false)
  const alive = useRef(false)

  async function read() {
    const current = generation.current

    try {
      const next = await api(`web/rigs/${encodeURIComponent(rigId)}/alignment`, {
        signal: AbortSignal.timeout(5000),
      })

      validateView(next, rigId)

      if (alive.current && current === generation.current) {
        setView(next)
        setOffline(false)

        if (
          endUnconfirmed.current &&
          !next.active &&
          ['stopped', 'finished', 'failed'].includes(next.phase)
        ) {
          endUnconfirmed.current = false
          setError(null)
        }
      }
    } catch {
      if (alive.current && current === generation.current) setOffline(true)
    }
  }

  useEffect(() => {
    alive.current = true
    let disposed = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      if (!writing.current) await read()

      if (!disposed) timer = setTimeout(poll, 750)
    }

    void poll()

    return () => {
      disposed = true
      alive.current = false
      generation.current++
      clearTimeout(timer)
    }
  }, [rigId])

  async function command(action: 'start' | 'stop' | 'finish') {
    if (writing.current || offline || endUnconfirmed.current || view?.activity === 'stopping')
      return
    writing.current = true
    generation.current++
    setPending(true)
    setError(null)

    try {
      const result = await api(`rigs/${encodeURIComponent(rigId)}/alignment/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15000),
      })

      validateView(result, rigId)

      if (alive.current) {
        setView(result)
        setOffline(false)
      }
    } catch (cause) {
      if (action !== 'start') endUnconfirmed.current = true

      if (alive.current)
        setError(
          `${cause instanceof Error ? cause.message : 'Command response unavailable'}. The command was not repeated; check the current state before trying again.`,
        )
      await read()
    } finally {
      writing.current = false

      if (alive.current) setPending(false)
    }
  }

  return { view, offline, pending, error, endUnconfirmed: endUnconfirmed.current, command }
}

const measurementSchema = z.object({
  altitudeArcsec: z.number(),
  azimuthArcsec: z.number(),
  totalArcsec: z.number(),
  targetX: z.number(),
  targetY: z.number(),
  imageWidth: z.number().positive(),
  imageHeight: z.number().positive(),
  fieldHeightDegrees: z.number().positive(),
  capturedAtSource: z.enum(['camera', 'server-estimate']).optional(),
  imageUrl: z.string().startsWith('/api/'),
})

const alignmentSchema = z.object({
  rigId: z.string(),
  rigName: z.string(),
  enabled: z.boolean(),
  error: z.string().nullable(),
  warning: z.string().nullable(),
  unavailableReason: z.string().nullable(),
  mode: z.enum(['physical', 'offline']).optional(),
  cameraName: z.string().optional(),
  active: z.boolean(),
  phase: z.enum(['setup', 'baseline', 'adjusting', 'stopped', 'finished', 'failed']),
  activity: z.enum([
    'idle',
    'exposing',
    'solving',
    'homing',
    'moving',
    'waiting',
    'retrying',
    'stopping',
  ]),
  position: z.number(),
  solvedPositions: z.number(),
  exposureSeconds: z.number().positive(),
  measuredAt: z
    .string()
    .refine(time => Number.isFinite(Date.parse(time)))
    .nullable(),
  exposureStartedAt: z
    .string()
    .refine(time => Number.isFinite(Date.parse(time)))
    .nullable(),
  measurement: measurementSchema.nullable(),
  preview: z
    .object({
      imageUrl: z.string().startsWith('/api/'),
      imageWidth: z.number().positive(),
      imageHeight: z.number().positive(),
      capturedAt: z.string().refine(time => Number.isFinite(Date.parse(time))),
      capturedAtSource: z.enum(['camera', 'server-estimate']).optional(),
      position: z.number(),
    })
    .nullable()
    .optional(),
})

/** Reject malformed state before it can be shown as a confirmed observation. */
function validateView(value: unknown, rigId: string): asserts value is AlignmentView {
  const result = alignmentSchema.safeParse(value)

  if (!result.success || result.data.rigId !== rigId) throw new Error('Invalid alignment response')
}

function useSolvedMeasurement(view: AlignmentView | null) {
  const [solved, setSolved] = useState<{
    measurement: NonNullable<AlignmentView['measurement']>
    measuredAt: string | null
  } | null>(null)

  const [imageError, setImageError] = useState(false)
  useEffect(() => {
    const measurement = view?.measurement

    if (!measurement) {
      setSolved(null)
      setImageError(false)

      return
    }

    const next = { measurement, measuredAt: view.measuredAt }
    let current = true
    let retry: ReturnType<typeof setTimeout> | undefined

    function load() {
      const image = new Image()
      image.onload = () => {
        if (current) {
          setSolved(next)
          setImageError(false)
        }
      }

      image.onerror = () => {
        if (!current) return
        setImageError(true)
        retry = setTimeout(load, 1500)
      }

      image.src = next.measurement.imageUrl
    }

    load()

    return () => {
      current = false
      clearTimeout(retry)
    }
  }, [view?.measurement?.imageUrl])

  return { solved, imageError }
}

function angle(value: number) {
  const seconds = Math.round(Math.abs(value))

  return seconds < 60 ? `${seconds}″` : `${Math.floor(seconds / 60)}′ ${seconds % 60}″`
}

function alignmentActivity(view: AlignmentView, offline: boolean) {
  if (offline) return 'Connection interrupted'

  if (view.activity === 'retrying') return 'Device connection interrupted · Retrying…'

  if (view.activity === 'exposing') return 'Exposing image'

  if (view.activity === 'solving') return 'Plate-solving…'

  if (view.activity === 'homing') return 'Preparing starting field…'

  if (view.activity === 'moving') return `Moving to position ${view.position}…`

  if (view.activity === 'stopping') return 'Stopping…'

  if (view.phase === 'finished') return 'Alignment ended by you'

  if (!view.active) return 'Measurements stopped'

  if (view.activity === 'waiting') return 'Waiting for the next image'

  if (view.measurement) return 'Alignment updated'

  return 'Preparing measurement…'
}

export function Alignment() {
  const { rigId = '' } = useParams()

  return <AlignmentPage key={rigId} rigId={rigId} />
}

function AlignmentPage({ rigId }: { rigId: string }) {
  const { view, offline, pending, error, endUnconfirmed, command } = useAlignment(rigId)
  const { solved, imageError } = useSolvedMeasurement(view)
  const [now, setNow] = useState(Date.now())
  const [expandedImage, setExpandedImage] = useState<ExpandedAlignmentImage | null>(null)
  const imageOpenerId = useId()
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)

    return () => clearInterval(timer)
  }, [])

  const back = (
    <Link className="vela-polar-back" to={`/rigs/${encodeURIComponent(rigId)}/observe/capture`}>
      ← Tonight
    </Link>
  )

  if (!view)
    return (
      <section className="vela-alignment">
        <header className="vela-polar-heading">
          {back}
          <h1>Polar alignment</h1>
        </header>
        <p role="status">
          {offline ? 'Alignment state unavailable. Reconnecting…' : 'Loading alignment…'}
        </p>
      </section>
    )
  const physical = view.mode === 'physical'
  const disabled = pending || offline || endUnconfirmed || view.activity === 'stopping'
  const measurement = solved?.measurement ?? null
  const baseline = !measurement || view.phase === 'baseline'

  const elapsed = view.exposureStartedAt
    ? Math.min(view.exposureSeconds, Math.max(0, (now - Date.parse(view.exposureStartedAt)) / 1000))
    : 0

  // The controller publishes the solved frame's exposure start as measuredAt, not solve completion.
  const age = solved?.measuredAt
    ? `${Math.max(0, Math.floor((now - Date.parse(solved.measuredAt)) / 1000))} seconds ago`
    : 'Not measured'

  const activity = alignmentActivity(view, offline)
  const retrying = view.activity === 'retrying'
  const interrupted = offline || retrying
  const imageReadState = offline ? 'offline' : retrying ? 'retrying' : 'current'
  const lastCorrection = !view.active || interrupted || imageError || endUnconfirmed

  const nextInstruction = view.active
    ? 'After the third solve, the adjustment view will show your alignment error and the target reticle.'
    : physical
      ? 'Each attempt homes, then moves to a consistent starting field at Dec +80°. Prepare a clear movement corridor: after a small direction check, Vela makes two continuous westward RA rotations of roughly 54° at 1° per second. Allow up to 120° total westward travel and 1° on either side for the direction check.'
      : 'Start with the simulator’s large-error preset and clear camera. Keep its offsets unchanged until all three positions are measured.'

  const preparationInstruction =
    physical && !view.active
      ? 'Use sidereal tracking. Keep the mount’s adjustment knobs still until all three positions are measured. You can stop at any time.'
      : 'You can stop the measurement at any time.'

  let adjustmentInstruction

  if (interrupted || imageError || endUnconfirmed) {
    adjustmentInstruction = 'Baseline retained. Wait for a fresh measurement before adjusting.'
  } else if (view.active) {
    adjustmentInstruction = physical
      ? 'Adjust the mount manually, then wait for a fresh measurement.'
      : 'Adjust the simulator’s offsets, then wait for a fresh measurement.'
  } else if (view.phase === 'finished') {
    adjustmentInstruction = 'Your final measurement is kept here for reference.'
  } else {
    adjustmentInstruction = physical
      ? 'Reposition the rig, then measure a fresh baseline before adjusting again.'
      : 'Reset or reposition the simulator, then measure a fresh baseline.'
  }

  let statusTitle = activity

  let statusDetail = view.active
    ? 'Baseline set · New measurements arriving'
    : 'Last measurement kept for reference'

  if (endUnconfirmed) {
    statusTitle = 'Command outcome unknown'
    statusDetail = 'Waiting for a confirmed session state'
  } else if (interrupted) {
    statusTitle = 'Measurements interrupted'
    statusDetail = offline
      ? 'Pause adjustments · Reconnecting to Vela'
      : 'Pause adjustments · Retrying camera reads'
  } else if (view.active && view.activity === 'waiting') {
    statusTitle = `Adjusting · Updated ${age}`
  }

  const activityArea = (
    <div className="vela-polar-activity">
      <div className="vela-polar-activity__line" role="status">
        {view.active && !interrupted && (
          <span className="vela-polar-activity__spinner" aria-hidden="true" />
        )}
        <strong>{activity}</strong>
      </div>
      <p>{view.solvedPositions} of 3 positions solved · Alignment error not yet available</p>
      {view.activity === 'exposing' && !interrupted && (
        <p>{elapsed.toFixed(1)} / {view.exposureSeconds} seconds</p>
      )}
    </div>
  )

  return (
    <section className="vela-alignment" data-pending={pending || undefined}>
      <header className="vela-polar-heading">
        {back}
        <h1>Polar alignment</h1>
        <span>{view.rigName} · Rig preparation</span>
      </header>
      {view.warning && !retrying && (
        <div className="vela-polar-solve-warning" role="alert">
          <strong>Plate-solving failed</strong>
          <p>
            {view.active && !offline && view.activity !== 'stopping' ? 'Trying another image. ' : ''}
            {measurement ? 'Showing the last successful solve.' : 'No alignment result yet.'}
          </p>
        </div>
      )}
      {imageError && (
        <p className="vela-polar-notice" role="status">
          The latest solved image could not be loaded. Previous readings and overlay remain
          together.
        </p>
      )}
      {(error || view.error || !view.enabled) && (
        <p className="vela-polar-notice" role="status">
          {error || view.error || view.unavailableReason}
        </p>
      )}
      {baseline ? (
        <div className="vela-polar-baseline">
          <Panel className="vela-polar-baseline__summary">
            <h2>
              {view.active
                ? 'Measuring your alignment'
                : view.phase === 'setup'
                  ? 'Find your starting alignment'
                  : 'Measurement stopped'}
            </h2>
            <p>
              {view.active
                ? 'Keep the mount’s adjustment knobs still while Vela measures three positions.'
                : 'Vela will take and solve images at three positions, then show you how to adjust the mount.'}
            </p>
            <ol className="vela-polar-points" aria-label="Three measurement positions">
              {[1, 2, 3].map(point => {
                const solved = point <= view.solvedPositions
                const current = view.active && point === view.position
                const state = solved ? 'done' : current ? 'current' : 'pending'

                const status = solved
                  ? 'Solved'
                  : !current
                    ? 'Not measured'
                    : offline || retrying
                      ? 'Observation interrupted'
                      : view.activity === 'homing'
                        ? 'Preparing starting field…'
                        : view.activity === 'moving'
                          ? 'Moving'
                          : 'Measuring'

                return (
                  <li key={point} data-state={state}>
                    <span>{solved ? '✓' : point}</span>
                    <strong>Position {point}</strong>
                    <small>{status}</small>
                  </li>
                )
              })}
            </ol>
            {view.active ? (
              activityArea
            ) : (
              <dl className="vela-polar-setup-facts">
                <div>
                  <dt>Camera</dt>
                  <dd>
                    {physical
                      ? (view.cameraName ?? 'No imaging camera configured')
                      : 'Configured imaging camera'}
                  </dd>
                </div>
                <div>
                  <dt>Exposure</dt>
                  <dd>{view.exposureSeconds} seconds</dd>
                </div>
                <div>
                  <dt>Starting point</dt>
                  <dd>
                    {physical ? 'Dec +80° · consistent starting field' : 'Configured sky patch'}
                  </dd>
                </div>
              </dl>
            )}
            {view.active && (
              <Button disabled={disabled} onClick={() => void command('stop')}>
                Stop measurement
              </Button>
            )}
            {view.preview && (
              <AlignmentImage
                frame={{
                  ...view.preview,
                  solution: null,
                  title: `Latest exposure · Position ${view.preview.position}`,
                  alt: `Latest camera exposure at baseline position ${view.preview.position}`,
                }}
                readState={imageReadState}
                now={now}
                retained={!view.active}
                noSolution={!!view.warning && !retrying}
                openerId={imageOpenerId}
                onEnlarge={setExpandedImage}
              />
            )}
          </Panel>
          <div className="vela-polar-baseline__next">
            <h3>{view.active ? 'What happens next' : 'Before you start'}</h3>
            <p>{nextInstruction}</p>
            <p>{preparationInstruction}</p>
            {!view.active && (
              <Button
                tone="accent"
                disabled={disabled || !view.enabled}
                onClick={() => void command('start')}
              >
                {view.phase === 'setup' ? 'Start measurement' : 'Start again'}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="vela-polar-layout">
          <div
            className="vela-polar-status"
            data-warning={interrupted || endUnconfirmed || undefined}
            role="status"
          >
            <strong>
              {view.active && !interrupted && !endUnconfirmed && (
                <i className="vela-polar-status-dot" aria-hidden="true" />
              )}
              {statusTitle}
            </strong>
            <span>{statusDetail}</span>
          </div>
          <div className="vela-polar-total">
            <div>
              <span>Last measured error</span>
              <span>
                {solved?.measuredAt ? (
                  <time dateTime={solved.measuredAt}>
                    {new Date(solved.measuredAt).toLocaleTimeString('en-GB')}
                  </time>
                ) : 'Time unavailable'}
                {lastCorrection ? ` · ${age}` : ''}
              </span>
            </div>
            <strong>{angle(measurement.totalArcsec)}</strong>
          </div>
          <AlignmentImage
            frame={{
              ...measurement,
              solution: measurement,
              capturedAt: solved?.measuredAt ?? null,
              title: 'Last solved frame',
              alt: 'Solved camera image with frame reference and alignment target',
            }}
            readState={imageReadState}
            now={now}
            retained={
              !view.active ||
              imageError ||
              view.activity !== 'waiting' ||
              view.measurement?.imageUrl !== measurement.imageUrl
            }
            openerId={imageOpenerId}
            onEnlarge={setExpandedImage}
          />
          <div className="vela-polar-directions" aria-label="Mount adjustment directions">
            <div>
              <span>Azimuth · horizontal</span>
              <strong>
                {lastCorrection ? 'Last: ' : measurement.azimuthArcsec >= 0 ? '← Move ' : '→ Move '}
                {measurement.azimuthArcsec >= 0 ? 'left' : 'right'} {angle(measurement.azimuthArcsec)}
              </strong>
            </div>
            <div>
              <span>Altitude · vertical</span>
              <strong>
                {lastCorrection ? 'Last: ' : measurement.altitudeArcsec >= 0 ? '↓ Move ' : '↑ Move '}
                {measurement.altitudeArcsec >= 0 ? 'down' : 'up'} {angle(measurement.altitudeArcsec)}
              </strong>
            </div>
          </div>
          <div className="vela-polar-actions">
            <p>{adjustmentInstruction}</p>
            {view.active ? (
              <div data-interrupted={interrupted || undefined}>
                <Button disabled={disabled} onClick={() => void command('stop')}>
                  {interrupted ? 'Stop session' : 'Stop'}
                </Button>
                {!interrupted && (
                  <Button
                    tone="accent"
                    disabled={disabled}
                    onClick={() => void command('finish')}
                  >
                    Finish alignment
                  </Button>
                )}
              </div>
            ) : (
              <Button
                disabled={disabled || !view.enabled}
                onClick={() => void command('start')}
              >
                Measure again
              </Button>
            )}
          </div>
          {view.activity === 'exposing' && !interrupted && (
            <p className="vela-polar-operation-detail">
              Exposure in progress · {elapsed.toFixed(1)} / {view.exposureSeconds} seconds
            </p>
          )}
        </div>
      )}
      <AlignmentImageDialog
        image={expandedImage}
        readState={imageReadState}
        now={now}
        openerId={imageOpenerId}
        onDismiss={() => setExpandedImage(null)}
      />
      <footer className="vela-polar-prototype">
        {physical
          ? 'Physical-rig alignment trial · Camera images and plate solves'
          : 'Configured offline alignment model · Generated sky images, real plate solves · Physical-rig alignment is not yet validated.'}
      </footer>
    </section>
  )
}
