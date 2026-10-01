import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isAutofocusView } from '../../../src/features/autofocus/validation'
import { autofocusResult, autofocusScenes, createAutofocusScene } from './autofocus'

const read = '/api/web/rigs/fra400/autofocus'

const start = '/api/rigs/fra400/autofocus/start'

const stop = '/api/rigs/fra400/autofocus/stop'

describe('Fieldroom autofocus scene boundary', () => {
  it('passes production validation and never dates a sample after its scene clock', () => {
    for (const name of autofocusScenes) {
      const scene = createAutofocusScene(name)
      const view = scene.snapshot()
      expect(isAutofocusView(view, 'fra400'), name).toBe(true)

      for (const sample of view.samples) expect(Date.parse(sample.capturedAt)).toBeLessThanOrEqual(Date.parse(scene.time))
      expect(scene.respond('GET', read).status).toBe(200)
      expect(scene.unknownRequests).toEqual([])
    }
  })

  it('matches frozen walking values while distinguishing start, current and fitted focus', () => {
    const reference = JSON.parse(readFileSync('docs/visual-reference/fieldroom/autofocus-reference-fixtures.json', 'utf8'))
    const view = createAutofocusScene('autofocus-running').snapshot()
    expect(view.samples.map(sample => ({ position: sample.position, hfr: sample.hfrPixels }))).toEqual(reference.walking.samples)
    expect(view.startPosition).toBe(reference.startPosition)
    expect(view.currentPosition).toBe(reference.walking.currentPosition)
    expect(view.fit).toBeNull()
    expect(view.samples.at(-1)?.capturedAt).toBe('2026-10-01T01:03:10.000Z')
    expect(autofocusResult.fit?.position).toBe(reference.outcomes.completed.fittedMinimum)
    expect(autofocusResult.fit?.minSamplePosition).toBe(reference.outcomes.completed.lowestMeasuredSamplePosition)
    expect(autofocusResult.currentPosition).not.toBe(autofocusResult.fit?.minSamplePosition)
  })

  it('starts only a valid window and leaves sample advancement to explicit scripted state', () => {
    const scene = createAutofocusScene('autofocus-ready')
    expect(scene.respond('POST', start, { stepSize: 50, exposureSeconds: 2 }).status).toBe(200)
    expect(scene.snapshot()).toMatchObject({ startPosition: 32842, currentPosition: 32842, active: true, samples: [], fit: null })
    scene.respond('GET', read)
    expect(scene.snapshot().samples).toHaveLength(0)
    const invalid = createAutofocusScene('autofocus-invalid-window')
    expect(invalid.respond('POST', start, { stepSize: 50, exposureSeconds: 2 }).status).toBe(409)
    expect(invalid.snapshot()).toMatchObject({ active: false, currentPosition: 150, startPosition: null })
  })

  it('keeps restoration pending/failed separate from confirmed return and response uncertainty', () => {
    const scene = createAutofocusScene('autofocus-stop-pending')
    scene.respond('POST', stop, {})
    expect(scene.snapshot()).toMatchObject({ activity: 'stopping', active: true, restoredStart: false })
    const failed = createAutofocusScene('autofocus-restore-unconfirmed').snapshot()
    expect(failed.restoredStart).toBe(false)
    expect(failed.currentPosition).toBe(32792)
    scene.setView(failed)
    expect(scene.respond('GET', read).json).toMatchObject({ phase: 'failed', restoredStart: false })
    const unknown = createAutofocusScene('autofocus-stop-unconfirmed')
    expect(unknown.respond('POST', stop, {}).status).toBe(503)
    expect(unknown.respond('GET', read).json).toMatchObject({ active: true, activity: 'stopping', restoredStart: false })
    unknown.setView(createAutofocusScene('autofocus-restored').snapshot())
    expect(unknown.respond('GET', read).json).toMatchObject({ phase: 'stopped', restoredStart: true, currentPosition: 32842 })
    expect(unknown.writes).toHaveLength(1)
  })

  it('captures response values before delay and isolates scripts, failures and unknown requests', () => {
    const scene = createAutofocusScene('autofocus-running')
    scene.setDelay(90000)
    const pending = scene.respond('GET', read)
    expect(pending.delayMs).toBe(60000)
    scene.setView(autofocusResult)
    expect(pending.json).toMatchObject({ phase: 'walking', fit: null })
    expect(createAutofocusScene('autofocus-running').snapshot().phase).toBe('walking')
    scene.setReadFailure(503)
    expect(scene.respond('GET', read).status).toBe(503)
    scene.setReadFailure(null)
    expect(scene.respond('GET', read).status).toBe(200)
    expect(scene.respond('POST', '/api/rigs/fra400/autofocus/home', {}).status).toBe(501)
    expect(scene.respond('GET', '/api/rigs/fra400/autofocus/images/imaginary').status).toBe(501)
    expect(scene.unknownRequests).toHaveLength(2)
  })
})
