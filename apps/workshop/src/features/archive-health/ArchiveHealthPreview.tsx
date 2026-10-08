import { useEffect, useState } from 'react'
import { Button } from '@vela/ui'
import { ArchivePreservation } from '../../../../web/src/features/archive/ArchivePreservation'
import type { useArchiveHealth } from '../../../../web/src/features/archive/use-archive-health'
import { scenarios, type ScenarioName } from './fixtures'
import './archive-health.css'

export interface ArchiveHealthState {
  scenario: ScenarioName
  capturing: boolean
  /** What Check archive now finds once the simulated check completes. */
  afterCheck: ScenarioName
  /** The page has lost contact with the Vela server; the last view stays visible with its age. */
  interrupted?: boolean
}

/**
 * The application's own preservation panel beside a still capture card, driven by fixture
 * projections. Check archive now is simulated locally and commands nothing.
 */
export function ArchiveHealthPreview({ initialState }: { initialState: ArchiveHealthState }) {
  const [scenario, setScenario] = useState(initialState.scenario)
  const [reconciling, setReconciling] = useState(false)

  useEffect(() => {
    if (!reconciling) return

    const timer = window.setTimeout(() => {
      setScenario(initialState.afterCheck)
      setReconciling(false)
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [initialState.afterCheck, reconciling])

  const view = { ...scenarios[scenario], observedAt: new Date().toISOString() }

  const health: ReturnType<typeof useArchiveHealth> = {
    view,
    interruptedAt: initialState.interrupted ? Date.now() - 95_000 : null,
    reconciling,
    reconcileFailed: false,
    reconcile: async () => setReconciling(true),
  }

  return (
    <div className="archive-health-preview">
      <section className="archive-health-preview__capture" aria-label="Capture images">
        <strong>{initialState.capturing ? 'Capturing' : 'Ready for an exposure'}</strong>
        <p>{initialState.capturing ? 'Exposure 43 · 180 s · repeats until you stop' : 'Start capture from Tonight.'}</p>
        <Button tone="accent" disabled>
          {initialState.capturing ? 'Stop capture' : 'Start capture'}
        </Button>
      </section>
      <ArchivePreservation health={health} capturing={initialState.capturing} />
    </div>
  )
}
