import type { ModelSnapshotView, TargetPosition } from '@vela/model/web'
import { Badge, Panel } from '@vela/ui'
import { Link, useParams } from 'react-router'
import { useModel } from '../features/model/use-model'
import './model.css'

export function Model() {
  const { rigId = '' } = useParams()

  return <ModelPage key={rigId} rigId={rigId} />
}

function ModelPage({ rigId }: { rigId: string }) {
  const reading = useModel(rigId)
  const view = 'view' in reading ? reading.view : null

  return (
    <section className="rig-model" aria-label="Rig model">
      <header className="rig-model__heading">
        <div><h1>Pointing model</h1><p>Read-only assessments. No commands are sent by this view.</p></div>
        <Link to={`/rigs/${encodeURIComponent(rigId)}/observe/capture`}>← Tonight</Link>
      </header>
      {reading.state === 'loading' && <p role="status">Reading model…</p>}
      {(reading.state === 'unavailable' || reading.state === 'interrupted') && (
        <p role="status">Model unavailable. {view ? `Last received ${time(view.checkedAt)}. Values below are last known.` : 'Shadow service not running / no data.'}</p>
      )}
      {view && <p>Read at {time(view.checkedAt)}. Refreshes every five seconds while this tab is visible.</p>}
      {reading.state !== 'loading' && <>
        <ModelSource title="Shadow service" snapshot={view?.shadow.snapshot ?? null} shadow
          unavailable={view?.shadow.state !== 'available' || reading.state === 'interrupted'}
          checkpointAt={view?.shadow.checkpointAt ?? null} />
        <ModelSource title="Local Aim model" snapshot={view?.local ?? null}
          unavailable={reading.state !== 'current'} />
      </>}
    </section>
  )
}

function ModelSource({ title, snapshot, shadow = false, unavailable, checkpointAt }: {
  title: string
  snapshot: ModelSnapshotView | null
  shadow?: boolean
  unavailable: boolean
  checkpointAt?: number | null
}) {
  const fixes = snapshot?.fixes ?? []

  return (
    <Panel className="rig-model__source" aria-label={title}>
      <header className="rig-model__heading">
        <h2>{title}</h2>
        {shadow && <Badge tone="warning">Shadow</Badge>}
      </header>
      {shadow && <p>Observations only. These assessments do not control the rig.</p>}
      {(unavailable || !snapshot) && <p role="status">{shadow ? 'Shadow service not running / no data.' : 'Local model unavailable.'} {snapshot && 'Last checkpoint shown. It may no longer describe the rig.'}</p>}
      {checkpointAt != null && <p>Checkpoint {time(checkpointAt)}. A checkpoint older than 15 seconds is unavailable; quiet input also stops checkpoints.</p>}
      {snapshot && <>
        <div className="rig-model__position">
          <h3>Position <Badge tone={unavailable ? 'warning' : snapshot.position.state === 'known' ? 'positive' : 'neutral'}>{snapshot.position.state}</Badge></h3>
          <p>{snapshot.position.reason.replaceAll('-', ' ')} · since {time(snapshot.position.since)}</p>
          <p>Last mount observation {snapshot.observedAt === null ? 'unavailable' : time(snapshot.observedAt)}.</p>
          <p>Last fix {snapshot.lastFix ? `${snapshot.lastFix.imageId} · ${time(snapshot.lastFix.at)} · ${snapshot.lastFix.errorArcmin.total.toFixed(2)}′ error` : 'none'}.</p>
        </div>
        <h3>Per-frame pointing</h3>
        <p>Showing the last {fixes.length} of {snapshot.fixCount} fixes. {snapshot.rejectedCount} rejected joins. {snapshot.skippedCount} skipped frames.</p>
        <p>Centres are J2000 degrees. Historical fixes do not establish the current position.</p>
        {fixes.length === 0 ? <p>No solved frames yet.</p> : <>
          <ErrorTrend fixes={fixes} />
          <div className="rig-model__table">
            <table>
              <caption>Frame centres and pointing residuals</caption>
              <thead><tr><th>Frame / time</th><th>Solved centre</th><th>Mount claim</th><th>Error</th><th>East / north</th><th>Timing</th></tr></thead>
              <tbody>{[...fixes].reverse().map(fix => (
                <tr key={fix.imageId}>
                  <th scope="row">{fix.imageId}<small>{time(fix.at)}</small></th>
                  <td>{centre(fix.solvedJ2000)}</td><td>{centre(fix.reportedJ2000)}</td>
                  <td>{fix.errorArcmin.total.toFixed(2)}′</td>
                  <td>{fix.errorArcmin.east.toFixed(2)}′ / {fix.errorArcmin.north.toFixed(2)}′</td>
                  <td>{fix.timeTrust === 'camera' ? 'Camera' : 'Server estimate'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>}
      </>}
    </Panel>
  )
}

function ErrorTrend({ fixes }: { fixes: ModelSnapshotView['fixes'] }) {
  const max = Math.max(1, ...fixes.map(fix => fix.errorArcmin.total))
  const points = fixes.map((fix, index) => `${20 + index * 560 / Math.max(1, fixes.length - 1)},${120 - fix.errorArcmin.total / max * 100}`)

  return (
    <figure className="rig-model__trend">
      <svg viewBox="0 0 600 150" role="img" aria-label="Pointing error trend, oldest to newest">
        <path d="M20 20V120H580" fill="none" stroke="currentColor" opacity="0.3" />
        <polyline points={points.join(' ')} fill="none" stroke="var(--vela-accent)" strokeWidth="2" />
        {points.map((point, i) => <circle key={fixes[i]!.imageId} cx={point.split(',')[0]} cy={point.split(',')[1]} r="3" fill="var(--vela-accent)" />)}
        <text x="20" y="145">Oldest</text><text x="520" y="145">Newest</text>
        <text x="24" y="16">{max.toFixed(2)}′</text><text x="24" y="116">0′</text>
      </svg>
      <figcaption>Pointing error per solved frame in arcminutes. Frames are equally spaced; the table gives their times.</figcaption>
    </figure>
  )
}

function centre(position: TargetPosition) {
  return `${position.raDegrees.toFixed(4)}°, ${position.decDegrees.toFixed(4)}°`
}

function time(at: number) {
  return new Date(at).toLocaleString([], { hour12: false })
}
