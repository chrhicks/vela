import type { AlignmentView } from '@vela/model/web'
import { Badge, Button, Panel } from '@vela/ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../lib/api'
import './alignment.css'

function useAlignment(rigId: string) {
  const [view, setView] = useState<AlignmentView | null>(null)
  const [offline, setOffline] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const writing = useRef(false)
  const alive = useRef(false)
  async function read() {
    const current = generation.current
    try {
      const next = await api<AlignmentView>(`web/rigs/${encodeURIComponent(rigId)}/alignment`, { signal: AbortSignal.timeout(5000) })
      validateView(next, rigId)
      if (alive.current && current === generation.current) { setView(next); setOffline(false) }
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
    return () => { disposed = true; alive.current = false; generation.current++; clearTimeout(timer) }
  }, [rigId])
  async function command(action: 'start' | 'stop' | 'finish') {
    if (writing.current || offline) return
    writing.current = true
    generation.current++
    setPending(true)
    setError(null)
    try {
      const result = await api<AlignmentView>(`rigs/${encodeURIComponent(rigId)}/alignment/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000),
      })
      validateView(result, rigId)
      if (alive.current) { setView(result); setOffline(false) }
    } catch (cause) {
      if (alive.current) setError(`${cause instanceof Error ? cause.message : 'Command response unavailable'}. The command was not repeated; check the current state before trying again.`)
      await read()
    } finally {
      writing.current = false
      if (alive.current) setPending(false)
    }
  }
  return { view, offline, pending, error, command }
}

/** Reject malformed state before it can be shown as a confirmed observation. */
function validateView(value: AlignmentView, rigId: string) {
  if (!value || value.rigId !== rigId || typeof value.rigName !== 'string' || typeof value.enabled !== 'boolean'
    || ![value.error, value.warning, value.unavailableReason].every(text => text === null || typeof text === 'string')
    || (value.mode !== undefined && !['physical', 'offline'].includes(value.mode))
    || (value.cameraName !== undefined && typeof value.cameraName !== 'string')
    || typeof value.active !== 'boolean' || !['setup', 'baseline', 'adjusting', 'stopped', 'finished', 'failed'].includes(value.phase)
    || !['idle', 'exposing', 'solving', 'homing', 'moving', 'waiting', 'stopping'].includes(value.activity)
    || !Number.isFinite(value.position) || !Number.isFinite(value.solvedPositions) || !Number.isFinite(value.exposureSeconds)
    || value.exposureSeconds <= 0 || ![value.measuredAt, value.exposureStartedAt].every(time => time === null || (typeof time === 'string' && Number.isFinite(Date.parse(time))))) throw new Error('Invalid alignment response')
  const m = value.measurement
  if (m !== null && (!m || ![m.altitudeArcsec, m.azimuthArcsec, m.totalArcsec, m.targetX, m.targetY, m.imageWidth, m.imageHeight, m.fieldHeightDegrees].every(Number.isFinite)
    || (m.capturedAtSource !== undefined && !['camera', 'server-estimate'].includes(m.capturedAtSource))
    || m.imageWidth <= 0 || m.imageHeight <= 0 || m.fieldHeightDegrees <= 0 || typeof m.imageUrl !== 'string' || !m.imageUrl.startsWith('/api/'))) throw new Error('Invalid alignment measurement')
}

function useSolvedMeasurement(view: AlignmentView | null) {
  const [solved, setSolved] = useState<{ measurement: NonNullable<AlignmentView['measurement']>; measuredAt: string | null } | null>(null)
  const [imageError, setImageError] = useState(false)
  useEffect(() => {
    const measurement = view?.measurement
    if (!measurement) { setSolved(null); setImageError(false); return }
    const next = { measurement, measuredAt: view.measuredAt }
    let current = true
    let retry: ReturnType<typeof setTimeout> | undefined
    function load() {
      const image = new Image()
      image.onload = () => { if (current) { setSolved(next); setImageError(false) } }
      image.onerror = () => {
        if (!current) return
        setImageError(true)
        retry = setTimeout(load, 1500)
      }
      image.src = next.measurement.imageUrl
    }
    load()
    return () => { current = false; clearTimeout(retry) }
  }, [view?.measurement?.imageUrl])
  return { solved, imageError }
}

function angle(value: number) {
  const seconds = Math.round(Math.abs(value))
  return seconds < 60 ? `${seconds}″` : `${Math.floor(seconds / 60)}′ ${seconds % 60}″`
}

export function Alignment() {
  const { rigId = '' } = useParams()
  return <AlignmentPage key={rigId} rigId={rigId} />
}

function AlignmentPage({ rigId }: { rigId: string }) {
  const { view, offline, pending, error, command } = useAlignment(rigId)
  const { solved, imageError } = useSolvedMeasurement(view)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer) }, [])
  const back = <Link className="vela-rig-page__back" to={`/rigs/${encodeURIComponent(rigId)}/observe`}>← Observe</Link>
  if (!view) return <section className="vela-rig-page">{back}<h1>Polar alignment</h1><p role="status">{offline ? 'Alignment state unavailable. Reconnecting…' : 'Loading alignment…'}</p></section>
  const physical = view.mode === 'physical'
  const disabled = pending || offline
  const measurement = solved?.measurement ?? null
  const baseline = !measurement || view.phase === 'baseline'
  const elapsed = view.exposureStartedAt ? Math.min(view.exposureSeconds, Math.max(0, (now - Date.parse(view.exposureStartedAt)) / 1000)) : 0
  const age = solved?.measuredAt ? `${Math.max(0, Math.floor((now - Date.parse(solved.measuredAt)) / 1000))} s ago` : 'Not measured'
  const activity = offline ? 'Connection interrupted' : view.activity === 'exposing' ? 'Exposing image' : view.activity === 'solving' ? 'Plate-solving…' : view.activity === 'homing' ? 'Preparing starting field…' : view.activity === 'moving' ? `Moving to position ${view.position}…` : view.activity === 'stopping' ? 'Stopping…' : view.phase === 'finished' ? 'Alignment ended by you' : !view.active ? 'Measurements stopped' : view.activity === 'waiting' ? 'Waiting for the next image' : view.measurement ? 'Alignment updated' : 'Preparing measurement…'
  const activityArea = <div className="vela-polar-activity">
    <div className="vela-polar-activity__line" role="status"><span className="vela-polar-activity__spinner" style={{ visibility: view.active && !offline ? 'visible' : 'hidden' }} aria-hidden="true" /><strong>{activity}</strong>{view.activity === 'exposing' && !offline && <span className="vela-polar-activity__time">{elapsed.toFixed(1)} / {view.exposureSeconds} s</span>}</div>
    <progress style={{ visibility: view.activity === 'exposing' && !offline ? 'visible' : 'hidden' }} value={elapsed} max={view.exposureSeconds} aria-label="Exposure progress in seconds" />
    <div className="vela-polar-activity__age"><span>Last alignment update</span><span>{age}{measurement?.capturedAtSource === 'server-estimate' ? ' · Estimated exposure start' : ''}</span></div>
    <p>{offline ? 'Readings and overlay are last known. Reconnecting…' : view.active ? 'Wait for a fresh alignment update after each adjustment.' : 'Readings and overlay are from the last successful solve.'}</p>
  </div>
  return <section className="vela-rig-page vela-alignment" data-pending={pending || undefined}>{back}
    <header className="vela-polar-heading"><div><p>{view.rigName} · Rig preparation</p><h1>Polar alignment</h1></div><Badge tone={offline || view.phase === 'failed' ? 'warning' : view.active ? 'accent' : 'neutral'}>{offline ? 'Disconnected' : view.phase === 'setup' ? 'Not started' : view.phase === 'baseline' ? 'Measuring' : view.phase}</Badge></header>
    {view.warning && <div className="vela-polar-solve-warning" role="alert">
      <strong>Plate-solving failed</strong>
      <p>{view.active && !offline && view.activity !== 'stopping' ? 'Trying another image. ' : ''}{measurement ? 'Showing the last successful solve.' : 'No alignment result yet.'}</p>
    </div>}
    {imageError && <p className="vela-polar-notice" role="status">The latest solved image could not be loaded. Previous readings and overlay remain together.</p>}
    {(error || view.error || !view.enabled) && <p className="vela-polar-notice" role="status">{error || view.error || view.unavailableReason}</p>}
    {baseline ? <div className="vela-polar-baseline">
      <Panel className="vela-polar-baseline__summary"><h2>{view.active ? 'Measuring your alignment' : view.phase === 'setup' ? 'Find your starting alignment' : 'Measurement stopped'}</h2><p>{view.active ? 'Keep the mount’s adjustment knobs still while Vela measures three positions.' : 'Vela will take and solve images at three positions, then show you how to adjust the mount.'}</p>
        <ol className="vela-polar-points" aria-label="Three measurement positions">{[1, 2, 3].map(point => <li key={point} data-state={point <= view.solvedPositions ? 'done' : view.active && point === view.position ? 'current' : 'pending'}><span>{point <= view.solvedPositions ? '✓' : point}</span><strong>Position {point}</strong><small>{point <= view.solvedPositions ? 'Solved' : view.active && point === view.position ? view.activity === 'homing' ? 'Preparing starting field…' : view.activity === 'moving' ? 'Moving' : 'Measuring' : 'Not measured'}</small></li>)}</ol>
        {view.active ? activityArea : <dl className="vela-polar-setup-facts"><div><dt>Camera</dt><dd>{physical ? view.cameraName ?? 'No imaging camera configured' : 'Configured imaging camera'}</dd></div><div><dt>Exposure</dt><dd>{view.exposureSeconds} seconds</dd></div><div><dt>Starting point</dt><dd>{physical ? '10° from home · Dec +80°' : 'Configured sky patch'}</dd></div></dl>}
      </Panel><div className="vela-polar-baseline__next"><h3>{view.active ? 'What happens next' : 'Before you start'}</h3><p>{view.active ? 'After the third solve, the adjustment view will show your alignment error and the target reticle.' : physical ? 'Each attempt homes, then moves 10° away from the pole before taking images. Prepare a clear movement corridor: Vela checks RA direction within 1° on either side, then rotates RA westward in two roughly 18° steps. Allow up to 40° total westward movement.' : 'Start with the simulator’s large-error preset and clear camera. Keep its offsets unchanged until all three positions are measured.'}</p><p>{physical && !view.active ? 'Use sidereal tracking. Keep the mount’s adjustment knobs still until all three positions are measured. You can stop at any time.' : 'You can stop the measurement at any time.'}</p><Button size="large" tone={view.active ? 'neutral' : 'accent'} disabled={disabled || (!view.active && !view.enabled)} onClick={() => void command(view.active ? 'stop' : 'start')}>{view.active ? 'Stop measurement' : view.phase === 'setup' ? 'Start measurement' : 'Start again'}</Button></div>
    </div> : <div className="vela-polar-layout">
      <Panel className="vela-polar-readings"><div className="vela-polar-total"><span>Last measured error</span><strong>{angle(measurement.totalArcsec)}</strong></div><div className="vela-polar-directions" aria-label="Mount adjustment directions">
        <div><span>Azimuth · horizontal</span><strong>{measurement.azimuthArcsec >= 0 ? '←' : '→'} {angle(measurement.azimuthArcsec)}</strong><span>{!view.active || offline ? 'Last correction: ' : 'Move '}{measurement.azimuthArcsec >= 0 ? 'left' : 'right'}</span></div><div><span>Altitude · vertical</span><strong>{measurement.altitudeArcsec >= 0 ? '↓' : '↑'} {angle(measurement.altitudeArcsec)}</strong><span>{!view.active || offline ? 'Last correction: ' : 'Move '}{measurement.altitudeArcsec >= 0 ? 'down' : 'up'}</span></div>
      </div>{activityArea}</Panel>
      <SolvedFrame measurement={measurement} />
      <div className="vela-polar-actions"><p>{view.active ? physical ? 'Adjust the mount’s altitude and azimuth knobs. Use the reticle and remaining error to decide when you’re done.' : 'Adjust the simulator’s offsets. Use the reticle and remaining error to decide when you’re done.' : view.phase === 'finished' ? 'Your final measurement is kept here for reference.' : physical ? 'Prepare the rig and clear movement corridor again, then measure a fresh baseline.' : 'Reset or reposition the simulator, then measure a fresh baseline.'}</p>{view.active ? <div><Button size="large" disabled={disabled} onClick={() => void command('stop')}>Stop to reposition</Button><Button size="large" tone="accent" disabled={disabled} onClick={() => void command('finish')}>Finish alignment</Button></div> : <Button size="large" disabled={disabled || !view.enabled} onClick={() => void command('start')}>Measure again</Button>}</div>
    </div>}
    <footer className="vela-polar-prototype">{physical ? 'Physical-rig alignment trial · Camera images and plate solves' : 'Configured offline alignment model · Generated sky images, real plate solves · Physical-rig alignment is not yet validated.'}</footer>
  </section>
}

function SolvedFrame({ measurement: m }: { measurement: NonNullable<AlignmentView['measurement']> }) {
  const x = (m.imageWidth - 1) / 2
  const y = (m.imageHeight - 1) / 2
  const fieldHeight = m.imageHeight * (20 / 60) / m.fieldHeightDegrees
  const fieldWidth = fieldHeight * 1.6
  const scale = fieldHeight / 400
  const barX = x - fieldWidth / 2 + 24 * scale
  const barY = y + fieldHeight / 2 - 24 * scale
  return <figure className="vela-polar-image"><div className="vela-polar-image-heading"><span>Last solved frame</span><span>20′ field · fixed scale</span></div>
    <svg viewBox={`${x - fieldWidth / 2} ${y - fieldHeight / 2} ${fieldWidth} ${fieldHeight}`} role="img" aria-label="Solved camera image with frame reference and alignment target"><image href={m.imageUrl} width={m.imageWidth} height={m.imageHeight} />
      <g fill="none" stroke="var(--vela-polar-target)" strokeWidth={1.4 * scale}><circle cx={m.targetX} cy={m.targetY} r={16 * scale} /><circle cx={m.targetX} cy={m.targetY} r={32 * scale} opacity=".55" /><path d={`M${m.targetX - 48 * scale} ${m.targetY}h${36 * scale}m${24 * scale} 0h${36 * scale}M${m.targetX} ${m.targetY - 48 * scale}v${36 * scale}m0 ${24 * scale}v${36 * scale}`} /></g>
      <path d={`M${x} ${y}H${m.targetX}V${m.targetY}`} fill="none" stroke="var(--vela-polar-reference)" strokeWidth={1.4 * scale} strokeDasharray={`${5 * scale} ${5 * scale}`} /><line x1={x} y1={y} x2={m.targetX} y2={m.targetY} stroke="var(--vela-polar-reference)" strokeWidth={1.6 * scale} /><circle cx={x} cy={y} r={10 * scale} fill="none" stroke="var(--vela-polar-reference)" strokeWidth={1.5 * scale} />
      <path d={`M${barX} ${barY}h${fieldHeight / 10}m${-fieldHeight / 10} ${-4 * scale}v${8 * scale}m${fieldHeight / 10} ${-8 * scale}v${8 * scale}`} stroke="var(--vela-text-muted)" fill="none" strokeWidth={scale} />
      <text x={barX} y={barY - 12 * scale} fill="var(--vela-text-muted)" fontSize={14 * scale}>2′</text>
    </svg><figcaption><span><i /> Frame reference</span><span><i /> Alignment target</span></figcaption></figure>
}
