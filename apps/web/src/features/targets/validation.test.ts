import { describe, expect, it } from 'vitest'
import type { FramingView } from '@vela/model/web'
import { isFramingView } from './validation'

const view: FramingView = {
  captureReadState: 'current',
  rigId: 'rig',
  rigName: 'Rig',
  enabled: true,
  active: true,
  canCenter: false,
  checkCurrent: false,
  observedAt: '2026-09-21T00:00:00Z',
  error: null,
  unavailableReason: null,
  targetId: 'm31',
  exposureSeconds: 20,
  phase: 'downloading',
  pointingSide: 'unknown',
  focalLengthMm: 400,
  desired: { raDegrees: 10, decDegrees: 40 },
  camera: null,
  actual: null,
  centering: {
    toleranceArcminutes: .5,
    maxCorrections: 4,
    correction: 1,
    outcome: 'working',
    measurements: [
      {
        correction: 0,
        checkId: 'check',
        capturedAt: '2026-09-21T00:00:00Z',
        offsetArcminutes: 42.4,
        rotationDegrees: 180,
        pointingSide: 'west',
        pointingSideChanged: false,
        trend: 'starting',
      },
    ],
  },
}

describe('framing transport validation', () => {
  it('requires an explicit capture-read state independently of phase', () => {
    expect(isFramingView({ ...view, captureReadState: 'retrying' }, 'rig')).toBe(true)

    for (const captureReadState of [undefined, null, 'recovered']) {
      expect(isFramingView({ ...view, captureReadState }, 'rig')).toBe(false)
    }
  })
  it('accepts image transfer and unknown pointing side without losing centering measurements', () => {
    expect(isFramingView(view, 'rig')).toBe(true)
    expect(isFramingView({ ...view, centering: null }, 'rig')).toBe(true)
    expect(isFramingView(view, 'another-rig')).toBe(false)
  })

  it('rejects malformed progress before it can render or enable commands', () => {
    for (const invalid of [
      { pointingSide: 'predicted-east' },
      { desired: null },
      { targetId: null },
      { targetId: '' },
      { centering: undefined },
      { centering: { ...view.centering, outcome: 'success' } },
      { centering: { ...view.centering, measurements: null } },
      { centering: { ...view.centering, correction: 99 } },
      {
        centering: {
          ...view.centering,
          measurements: [{ ...view.centering!.measurements[0], correction: 2 }],
        },
      },
      {
        centering: {
          ...view.centering,
          measurements: [{ ...view.centering!.measurements[0], offsetArcminutes: -1 }],
        },
      },
      {
        centering: {
          ...view.centering,
          measurements: [{ ...view.centering!.measurements[0], pointingSideChanged: 'yes' }],
        },
      },
    ])
      expect(isFramingView({ ...view, ...invalid }, 'rig')).toBe(false)
  })
})
