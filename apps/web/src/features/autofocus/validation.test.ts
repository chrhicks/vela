import { describe, expect, it } from 'vitest'
import type { AutofocusView } from '@vela/model/web'
import { isAutofocusView, isTravelLimitError } from './validation'

const view: AutofocusView = {
  captureReadState: 'current',
  rigId: 'fra',
  rigName: 'FRA 400',
  enabled: true,
  unavailableReason: null,
  cameraName: 'ASI2600',
  focuserName: 'EAF',
  phase: 'walking',
  activity: 'exposing',
  active: true,
  startPosition: 32842,
  currentPosition: 33042,
  maxStep: 60000,
  stepSize: 50,
  offsetSteps: 4,
  exposureSeconds: 2,
  elapsedSeconds: 0.4,
  exposureStartedAt: '2026-09-17T00:00:00.000Z',
  samples: [{
    position: 33042,
    detectedStars: 12,
    hfrPixels: 5.1,
    capturedAt: '2026-09-17T00:00:00.000Z',
  }],
  fit: null,
  restoredStart: false,
  error: null,
}

const travelLimit: AutofocusView = {
  ...view,
  phase: 'setup',
  activity: 'idle',
  active: false,
  startPosition: null,
  currentPosition: 80,
  samples: [],
  error: 'That step-size window would approach 0 or MaxStep. Choose a smaller step or start farther from the ends. Vela will not move.',
}

describe('autofocus response validation', () => {
  it('requires an explicit capture-read state independently of activity', () => {
    expect(isAutofocusView({ ...view, captureReadState: 'retrying' }, 'fra')).toBe(true)

    for (const captureReadState of [undefined, null, 'recovered']) {
      expect(isAutofocusView({ ...view, captureReadState }, 'fra')).toBe(false)
    }
  })
  it('accepts a live walk whose start is the current EAF position', () => {
    expect(isAutofocusView(view, 'fra')).toBe(true)
    expect(isAutofocusView({ ...view, active: false }, 'fra')).toBe(false)
    expect(isAutofocusView(view, 'other')).toBe(false)
  })

  it('accepts a travel-limit abort, including a reported position of 0', () => {
    expect(isAutofocusView(travelLimit, 'fra')).toBe(true)
    expect(isAutofocusView({
      ...travelLimit,
      currentPosition: 0,
      error: 'The focuser is already at a mechanical limit. Autofocus starts from the current position and will not command 0 or MaxStep.',
    }, 'fra')).toBe(true)
    expect(isAutofocusView({ ...travelLimit, active: true }, 'fra')).toBe(false)
    expect(isTravelLimitError(travelLimit.error)).toBe(true)
    expect(isTravelLimitError('The focuser did not confirm return to the start position. Vela did not repeat the move.')).toBe(false)
  })

  it('accepts complete and unrestored failed views as idle terminal state', () => {
    expect(isAutofocusView({ ...view, phase: 'complete', activity: 'idle', active: false }, 'fra')).toBe(true)
    expect(isAutofocusView({
      ...view,
      phase: 'failed',
      activity: 'idle',
      active: false,
      restoredStart: false,
      error: 'The focuser did not confirm return to the start position. Vela did not repeat the move.',
    }, 'fra')).toBe(true)
  })

  it('rejects a sample that claims stars without HFR', () => {
    expect(isAutofocusView({
      ...view,
      samples: [{
        position: 33042,
        detectedStars: 3,
        hfrPixels: null,
        capturedAt: '2026-09-17T00:00:00.000Z',
      }],
    }, 'fra')).toBe(false)
  })
})
