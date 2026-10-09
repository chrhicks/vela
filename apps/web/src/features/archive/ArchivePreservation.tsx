import type { ArchiveIssue, CriaArchiveHealthView } from '@vela/model/web'
import { Button } from '@vela/ui'
import { useEffect, useState } from 'react'
import {
  age,
  formatBytes,
  hours,
  issueLabels,
  issueSteps,
  originals,
  preservationSummary,
  tallyText,
} from './presentation'
import type { useArchiveHealth } from './use-archive-health'
import './archive-preservation.css'

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Whether originals reaching Vela are safely preserved, beside the capture they come from. */
export function ArchivePreservation({
  health,
  capturing,
}: {
  health: ReturnType<typeof useArchiveHealth>
  capturing: boolean
}) {
  const { view, interruptedAt } = health

  if (view?.preservation === 'none') return null

  if (!view)
    return (
      <section className="tonight-preservation" aria-label="Preservation" data-tone="unknown">
        <div className="tonight-context__heading">
          <strong>Preservation</strong>
          <span role="status">{interruptedAt ? 'Status unavailable' : 'Checking…'}</span>
        </div>
        {interruptedAt && <p>Archive status could not be read. Vela retries quietly.</p>}
      </section>
    )

  return <Preservation view={view} health={health} capturing={capturing} />
}

function Preservation({
  view,
  health,
  capturing,
}: {
  view: CriaArchiveHealthView
  health: ReturnType<typeof useArchiveHealth>
  capturing: boolean
}) {
  const now = useNow()
  const summary = preservationSummary(view, capturing)
  const { destination, source, obligations, forecast, issues } = view
  const interrupted = health.interruptedAt !== null

  return (
    <section
      className="tonight-preservation"
      aria-label="Preservation"
      data-tone={interrupted ? 'unknown' : summary.tone}
    >
      <div className="tonight-context__heading">
        <strong>Preservation</strong>
        <span className="tonight-preservation__state" role="status">
          <span className="tonight-preservation__dot" aria-hidden="true" />
          {summary.title}
        </span>
      </div>
      <p>{summary.explanation}</p>
      {interrupted && (
        <p role="status">
          Archive status interrupted · last checked {age(view.observedAt, now)}. The values shown are
          last known.
        </p>
      )}
      {destination.intentRefusal && (
        <div className="tonight-preservation__notice" role="status">
          <strong>Capture not started</strong>
          <p>
            At {clock(destination.intentRefusal.at)} Vela could not record what the exposure was for
            ({destination.intentRefusal.detail}), so no exposure was requested.
          </p>
        </div>
      )}
      {summary.nextStep && <p className="tonight-preservation__next">{summary.nextStep}</p>}

      <details className="tonight-preservation__details">
        <summary>Archive details</summary>

        <h3>Where originals stand</h3>
        <dl>
          {(obligations.arriving?.count ?? 0) > 0 && (
            <Fact term="Arriving from this capture" value={tallyText(obligations.arriving)} />
          )}
          <Fact term="Waiting at Cria" value={tallyText(obligations.waitingAtCria)} />
          <Fact term="Being verified" value={tallyText(obligations.unverified)} />
          <Fact term="Waiting for Cria to confirm" value={tallyText(obligations.acknowledgementPending)} />
          <Fact term="Preserved in Vela" value={tallyText(obligations.preserved)} />
        </dl>
        <p>
          {obligations.archiveCountedAt
            ? `Archive counted ${age(obligations.archiveCountedAt, now)}.`
            : 'Vela is still counting its archive.'}
          {obligations.partial.includes('pending-copies-unchecked') && ' Some waiting originals may be counted twice.'}
          {obligations.partial.includes('missing-unchecked') && ' Not every missing record at Cria has been checked.'}
          {(obligations.partial.includes('cria-last-known') || obligations.partial.includes('archive-count-old')) && ' Some totals are last known.'}
        </p>

        {issues.shown.length > 0 && (
          <>
            <h3>{issues.total === 1 ? '1 original to check' : `${issues.total} originals to check`}</h3>
            <ul className="tonight-preservation__issues">
              {issues.shown.map(issue => <Issue key={issue.imageId} issue={issue} now={now} />)}
            </ul>
            {issues.total > issues.shown.length && <p>Showing the {issues.shown.length} most recent.</p>}
          </>
        )}

        <h3>Vela archive</h3>
        <dl>
          <Fact term="Folder" value={destination.location} />
          <Fact
            term="State"
            value={destination.problem ? `Unavailable · ${destination.problem.detail}` : 'Accepting originals'}
          />
          <Fact
            term="Free space"
            value={
              destination.space
                ? `${formatBytes(destination.space.freeBytes)} of ${formatBytes(destination.space.totalBytes)}`
                : 'Unknown'
            }
          />
          <Fact
            term="Last preserved"
            value={destination.lastPreservedAt ? age(destination.lastPreservedAt, now) : 'Not since Vela started'}
          />
        </dl>
        {destination.space?.basis === 'other-location' && (
          <p>
            Free space is measured at {destination.space.measuredPath}, not at the archive Vela opened.
            It is only an estimate.
          </p>
        )}

        <h3>Cria on the rig</h3>
        <dl>
          <Fact
            term="Read"
            value={
              source.observedAt
                ? `${source.current ? '' : 'Last known · '}${age(source.observedAt, now)}`
                : 'Not read yet'
            }
          />
          {source.capacity && (
            <>
              <Fact
                term="Local copies"
                value={`${formatBytes(source.capacity.committedBytes)} of ${formatBytes(source.capacity.budgetBytes)} · ${source.capacity.outstandingRecords} of ${source.capacity.recordLimit} records`}
              />
              <Fact term="Free disk" value={formatBytes(source.capacity.freeBytes)} />
              <Fact
                term="New captures"
                value={source.capacity.captureAdmissible ? 'Admitted' : `Refused · ${source.capacity.refusal ?? 'capacity reached'}`}
              />
            </>
          )}
          {source.extraCopies && source.extraCopies.count > 0 && (
            <Fact
              term="Extra copies kept"
              value={`${tallyText(source.extraCopies)}${source.releaseAfterReceipt === false ? ' · release after receipt is off' : ''}`}
            />
          )}
          {source.quarantined && <Fact term="Quarantined" value={tallyText(source.quarantined)} />}
          {source.missing && (
            <Fact
              term="Missing"
              value={source.missing.count === 0 ? 'None' : `${originals(source.missing.count)}${source.missing.complete ? '' : ' or more'}`}
            />
          )}
        </dl>
        {source.error && <p>Latest read failed: {source.error}</p>}

        <h3>Estimate</h3>
        <dl>
          <Fact term="Latest frame" value={forecast.frameBytes ? formatBytes(forecast.frameBytes.bytes) : 'No frame measured yet'} />
          <Fact
            term="Recent rate"
            value={
              forecast.rate
                ? `${Number(forecast.rate.framesPerHour.toFixed(1))} frames an hour, from the last ${forecast.rate.frames}`
                : forecast.rateUnknown === 'not-acquiring' ? 'Not acquiring' : 'Too few frames to tell'
            }
          />
          {forecast.destinationHours !== null && (
            <Fact term="Archive disk at this rate" value={`Full in ${hours(forecast.destinationHours)}`} />
          )}
          {forecast.criaCapturesBeforeRefusal !== null && (
            <Fact
              term="If archiving stopped"
              value={
                forecast.criaCapturesBeforeRefusal === 0
                  ? 'Cria is already refusing new captures'
                  : `Cria could admit about ${forecast.criaCapturesBeforeRefusal} more ${forecast.criaCapturesBeforeRefusal === 1 ? 'capture' : 'captures'}`
              }
            />
          )}
        </dl>
        <p>
          Capture runs continue until you stop them, so the total this session needs is unknown.
          Estimates assume frames like the latest one and no other programs writing to these disks;
          saved FITS files and previews are not included.
        </p>

        <div className="tonight-preservation__actions">
          <Button disabled={health.reconciling || view.reconciling} onClick={() => void health.reconcile()}>
            {health.reconciling || view.reconciling ? 'Checking archive…' : 'Check archive now'}
          </Button>
          <span>Checked {age(view.observedAt, now)}</span>
        </div>
        {health.reconcileFailed && <p role="status">The check did not complete. Current state is shown.</p>}
        <p>Checking resends the same receipts and copies the same originals. It never takes an exposure.</p>
      </details>
    </section>
  )
}

/** Re-render periodically so ages keep advancing while reads are interrupted. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)

    return () => clearInterval(timer)
  }, [])

  return now
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function Issue({ issue, now }: { issue: ArchiveIssue; now: number }) {
  return (
    <li>
      <strong>{issueLabels[issue.reason]}</strong>
      <p>{issue.detail}</p>
      <p>{issueSteps[issue.reason]}</p>
      <p className="tonight-preservation__meta">
        Image {issue.imageId}
        {issue.purpose ? ` · ${issue.purpose}` : ''} · {age(issue.observedAt, now)}
      </p>
    </li>
  )
}
