import { describe, expect, it } from 'vitest'
import type { FramingView } from '@vela/model/web'
import { isFramingView, isTarget, isTargetCatalog } from './validation'

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
  preview: null,
  centering: {
    toleranceArcminutes: 0.5,
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


it('accepts known or unavailable constellation context and rejects malformed catalog facts', () => {
  const target = {
    id: 'ngc0224', name: 'Andromeda Galaxy', catalog: 'NGC 224', kind: 'Galaxy',
    constellation: 'Andromeda', raDegrees: 10.6847, decDegrees: 41.2687,
    sizeArcminutes: 177.8, minorSizeArcminutes: 69.7, thumbnailUrl: '/api/survey/thumbnail', sky: null,
  }

  expect(isTarget(target)).toBe(true)
  expect(isTarget({ ...target, constellation: null })).toBe(true)

  for (const constellation of [undefined, '', '   ', 42]) {
    expect(isTarget({ ...target, constellation })).toBe(false)
  }
})

it('requires truthful independent preview identity and allows render/analysis unavailability', () => {
  const preview = { id: 'acquisition', rigId: 'rig', targetId: 'm31', width: 100, height: 80,
    exposureSeconds: 2, cameraName: 'Camera', capturedAt: view.observedAt, capturedAtSource: 'camera',
    checkId: null, previewUrl: null, nativePreviewUrl: null, statistics: null }

  expect(isFramingView({ ...view, preview }, 'rig')).toBe(true)

  for (const invalid of [{ rigId: 'wrong' }, { targetId: 'wrong' }, { width: 0 },
    { checkId: '' }, { capturedAtSource: 'inferred' }, { nativePreviewUrl: '/api/native' },
    { statistics: { detectedStars: -1, medianHfrPixels: 2 } }]) {
    expect(isFramingView({ ...view, preview: { ...preview, ...invalid } }, 'rig')).toBe(false)
  }

  expect(isFramingView({ ...view, preview: undefined }, 'rig')).toBe(false)
})

it('validates catalog facts without inventing rig or sky identity', () => {
  const target = { id: 'ngc0224', name: 'Andromeda', catalog: 'NGC 224', kind: 'Galaxy',
    constellation: 'Andromeda', raDegrees: 10.6847, decDegrees: 41.2687,
    sizeArcminutes: 177.8, minorSizeArcminutes: 69.7, thumbnailUrl: '/api/survey/thumbnail',
    category: 'galaxy', filterChoice: 'broadband', filterReason: 'Starlight' }

  const catalog = { query: 'M31', category: 'all', filter: 'all', offset: 0, pageSize: 3,
    total: 1, targets: [target] }

  expect(isTargetCatalog(catalog)).toBe(true)
  expect(isTargetCatalog({ ...catalog, rigId: '' })).toBe(false)
  expect(isTargetCatalog({ ...catalog, targets: [{ ...target, sky: null }] })).toBe(false)
  expect(isTargetCatalog({ ...catalog, pageSize: 13 })).toBe(false)
  expect(isTargetCatalog({ ...catalog, targets: [{ ...target, minorSizeArcminutes: undefined }] })).toBe(false)
})
