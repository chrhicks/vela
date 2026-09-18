import { describe, expect, it } from 'vitest'
import type { AutofocusView } from '@vela/model/web'
import { isAutofocusView } from './validation'

const view: AutofocusView = {
  rigId: 'fra', rigName: 'FRA 400', enabled: true, unavailableReason: null,
  cameraName: 'ASI2600', focuserName: 'EAF', phase: 'walking', activity: 'exposing', active: true,
  startPosition: 32842, currentPosition: 33042, maxStep: 60000, stepSize: 50, offsetSteps: 4,
  exposureSeconds: 2, elapsedSeconds: 0.4, exposureStartedAt: '2026-09-17T00:00:00.000Z',
  samples: [{ position: 33042, detectedStars: 12, hfrPixels: 5.1, capturedAt: '2026-09-17T00:00:00.000Z' }],
  fit: null, restoredStart: false, error: null,
}

describe('autofocus response validation', () => {
  it('accepts a live walk whose start is the current EAF position, not 0', () => {
    expect(isAutofocusView(view, 'fra')).toBe(true)
    expect(isAutofocusView({ ...view, startPosition: 0 }, 'fra')).toBe(false)
    expect(isAutofocusView({ ...view, active: false }, 'fra')).toBe(false)
    expect(isAutofocusView(view, 'other')).toBe(false)
  })

  it('rejects a sample that claims stars without HFR', () => {
    expect(isAutofocusView({
      ...view, samples: [{ position: 33042, detectedStars: 3, hfrPixels: null, capturedAt: '2026-09-17T00:00:00.000Z' }],
    }, 'fra')).toBe(false)
  })
})
