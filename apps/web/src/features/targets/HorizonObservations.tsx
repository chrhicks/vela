import type { HorizonObservationView } from '@vela/model/web'
import { Button } from '@vela/ui'
import { useEffect, useState } from 'react'
import { deleteHorizonObservation, fetchHorizonObservations } from './horizon-observations'
import './horizon-observations.css'

type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; observations: HorizonObservationView[] }

const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Where stars dropped out of a light run, with the direction the mount pointed. A wrong one (a cloud, not a
 * tree) can be deleted; that is the only edit.
 */
export function HorizonObservations({ rigId }: { rigId: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [deleting, setDeleting] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const request = new AbortController()

    setLoaded({ state: 'loading' })

    fetchHorizonObservations(rigId, AbortSignal.any([request.signal, AbortSignal.timeout(5000)]))
      .then(view => setLoaded({ state: 'ready', observations: view.observations }))
      .catch(() => {
        if (!request.signal.aborted) setLoaded({ state: 'failed' })
      })

    return () => request.abort()
  }, [rigId])

  async function remove(observation: HorizonObservationView) {
    setDeleting(observation.id)
    setFailure(null)

    try {
      await deleteHorizonObservation(rigId, observation.id)

      setLoaded(current =>
        current.state === 'ready'
          ? { state: 'ready', observations: current.observations.filter(item => item.id !== observation.id) }
          : current,
      )
    } catch {
      setFailure('That observation could not be deleted. Reload to see what is still recorded.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <section className="horizon-observations" aria-label="Star dropouts">
      <header>
        <h2>Star dropouts</h2>
        <p className="horizon-observations__muted">Where stars vanished in a light run. They correct the horizon.</p>
      </header>

      {loaded.state === 'loading' && <p className="horizon-observations__muted">Loading star dropouts…</p>}
      {loaded.state === 'failed' && <p className="horizon-observations__muted">Star dropouts could not be read.</p>}

      {loaded.state === 'ready' && loaded.observations.length === 0 && (
        <p className="horizon-observations__muted">None recorded yet.</p>
      )}

      {loaded.state === 'ready' && loaded.observations.length > 0 && (
        <ul className="horizon-observations__list">
          {loaded.observations.map(observation => (
            <li key={observation.id}>
              <span>
                {when(observation.at)} · azimuth {Math.round(observation.azimuthDegrees)}° · altitude{' '}
                {Math.round(observation.altitudeDegrees)}°
                <span className="horizon-observations__muted">
                  {' '}· {observation.strongBefore} strong stars before, {observation.strongAt} at the drop
                </span>
              </span>
              <Button
                onClick={() => void remove(observation)}
                disabled={deleting !== null}
                aria-label={`Delete the dropout of ${when(observation.at)}`}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      {failure && <p role="alert">{failure}</p>}
    </section>
  )
}
