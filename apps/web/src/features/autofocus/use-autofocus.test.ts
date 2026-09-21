import { expect, it } from 'vitest'
import type { AutofocusView } from '@vela/model/web'
import { autofocusActivity } from './use-autofocus'

const view: AutofocusView = {
  captureReadState: 'current',
  rigId: 'fra',
  rigName: 'FRA 400',
  enabled: true,
  unavailableReason: null,
  cameraName: 'ASI2600',
  focuserName: 'EAF',
  phase: 'failed',
  activity: 'idle',
  active: false,
  startPosition: 32842,
  currentPosition: 32992,
  maxStep: 60000,
  stepSize: 50,
  offsetSteps: 4,
  exposureSeconds: 2,
  elapsedSeconds: 0,
  exposureStartedAt: null,
  samples: [],
  fit: null,
  restoredStart: false,
  error: null,
}

it('labels travel-limit aborts separately from unrestored failures', () => {
  expect(autofocusActivity({
    ...view,
    phase: 'setup',
    startPosition: null,
    currentPosition: 80,
    error: 'That step-size window would approach 0 or MaxStep. Choose a smaller step or start farther from the ends. Vela will not move.',
  }, false)).toBe('Walk did not start')
  expect(autofocusActivity({
    ...view,
    error: 'The focuser did not confirm return to the start position. Vela did not repeat the move.',
  }, false)).toBe('Walk failed · start was not restored')
  expect(autofocusActivity({ ...view, restoredStart: true, currentPosition: 32842, error: 'Hyperbola failed' }, false))
    .toBe('Walk failed · start restored')
})
