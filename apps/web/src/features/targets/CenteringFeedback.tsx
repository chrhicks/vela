import type { FramingCentering, FramingView } from '@vela/model/web'
import { WorkingIndicator } from '@vela/ui'

export const arcminutes = (value: number) => `${value.toFixed(value < 10 ? 2 : 1)}′`

export function FramingStatus({ view, checked, centering, offline, pending, commandUnconfirmed }: {
  view: FramingView | null
  checked: boolean
  centering: FramingCentering | null
  offline: boolean
  pending: boolean
  commandUnconfirmed: boolean
}) {
  let title = 'Loading rig state…'
  let detail = ''

  if (view) {
    title = {
      idle: 'Ready to frame', slewing: 'Moving to your composition', settling: 'Waiting for the mount to settle',
      'needs-check': 'Ready to check the current frame', exposing: `Taking a ${view.exposureSeconds}-second test exposure`,
      downloading: 'Receiving the image', solving: 'Measuring the new framing', checked: checked ? 'Framing checked' : 'Composition not checked',
      stopping: 'Stopping framing', stopped: 'Framing stopped', failed: 'Framing not confirmed',
    }[view.phase]

    if (centering?.outcome === 'working' && view.active) {
      detail = centering.correction === 0
        ? 'Checking the current frame before any correction. A fresh solved exposure must confirm the framing.'
        : `Correction ${centering.correction} of at most ${centering.maxCorrections}. Each next move uses a fresh solved exposure.`
    } else if (centering?.outcome === 'centered' && checked && view.actual && view.actual.checkId === centering.measurements.at(-1)?.checkId) {
      title = 'Composition centered'
      detail = `The latest solved frame is within ${arcminutes(centering.toleranceArcminutes)} of your chosen center.`
    } else if (centering?.outcome === 'not-converging' && checked) {
      title = 'Centering is not converging'
      detail = 'Two corrections increased the error. Movement has stopped; inspect the result and check the current frame before trying again.'
    } else if (centering?.outcome === 'limit-reached' && checked) {
      title = 'Centering correction limit reached'
      detail = `${centering.correction} corrections measured. Movement has stopped outside the chosen tolerance; check the current frame before trying again.`
    } else if (centering?.outcome === 'interrupted') {
      title = view.phase === 'stopped' ? 'Centering stopped' : 'Centering interrupted'
      detail = 'No further correction is scheduled. Check the current frame before deciding what to do next.'
    }
  }

  if (offline) {
    title = 'Connection interrupted · last known state'
    detail = 'Current activity cannot be confirmed. Measurements below are last known; reconnect before sending another command.'
  } else if (commandUnconfirmed) {
    title = 'Check rig state before continuing'
    detail = 'The command outcome is uncertain. Inspect the rig state before another command.'
  } else if (pending) {
    title = 'Sending command…'
    detail = 'Waiting for the server to confirm the request.'
  } else if (view?.captureReadState === 'retrying') {
    title = 'Camera observation interrupted'
    detail = 'The server is connected. Retrying reads for the same exposure; no new exposure or correction will start while waiting. The last solved framing is kept. You can stop while reads retry.'
  }

  return <div className="vela-target-status" role="status" aria-live="polite">
    <WorkingIndicator active={!!view?.active && view.captureReadState === 'current' && !offline && !commandUnconfirmed && !pending} />
    <strong>{title}</strong>{detail && <p>{detail}</p>}
  </div>
}

function measurementLabel(correction: number, index: number) {
  if (index === 0) return 'Before centering'

  return correction === 0 ? 'Recheck' : `Correction ${correction}`
}

export function CenteringProgress({ centering, current }: { centering: FramingCentering, current: boolean }) {
  const measured = centering.measurements.filter(sample => sample.correction > 0).length

  return <section className="vela-target-progress" aria-label="Centering measurements">
    <header><h2>Measured progress</h2><span>{measured} {measured === 1 ? 'correction' : 'corrections'} measured{!current ? ' · last known' : ''}</span></header>
    <ol>{centering.measurements.map((sample, index) => <li key={sample.checkId} data-latest={current && index === centering.measurements.length - 1}>
      <span>{measurementLabel(sample.correction, index)}</span>
      <strong>{arcminutes(sample.offsetArcminutes)}</strong>
      <span>{{ starting: 'Starting frame', improved: 'Improved', worsened: 'Worsened', unchanged: 'Unchanged', 'within-tolerance': 'Within tolerance' }[sample.trend]}{sample.pointingSideChanged ? ' · side changed' : ''}</span>
    </li>)}</ol>
  </section>
}
