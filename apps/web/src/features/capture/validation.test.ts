import { describe, expect, it } from 'vitest'
import type { CaptureView } from '@vela/model/web'
import { isCaptureView } from './validation'

const view: CaptureView = {
  rigId: 'rig-1', rigName: 'Offline rig', camera: { name: 'Simulator Camera' }, enabled: true,
  unavailableReason: null, phase: 'exposing', active: true, exposureSeconds: 10, elapsedSeconds: 2,
  error: null, repeat: true, completedCount: 1,
  latestImage: {
    id: 'frame-1', imageUrl: '/api/rigs/rig-1/capture/images/frame-1', width: 1600, height: 1200,
    exposureSeconds: 2, capturedAt: '2026-09-05T18:00:00.000Z', receivedAt: '2026-09-05T18:00:03.000Z', cameraName: 'Simulator Camera', color: 'mono', statistics: { detectedStars: 12, medianHfrPixels: 2.35 },
  },
}

describe('capture response validation', () => {
  it('accepts a previous image with its own exposure metadata while another exposure runs', () => {
    expect(isCaptureView(view, 'rig-1')).toBe(true)
    expect(isCaptureView({ ...view, latestImage: null }, 'rig-1')).toBe(true)
    for (const statistics of [null, { detectedStars: 0, medianHfrPixels: null }]) {
      expect(isCaptureView({ ...view, latestImage: { ...view.latestImage, statistics } }, 'rig-1')).toBe(true)
    }
  })

  it('rejects mismatched rigs, contradictory active states, and invalid exposure progress', () => {
    expect(isCaptureView(view, 'other-rig')).toBe(false)
    expect(isCaptureView({ ...view, active: false }, 'rig-1')).toBe(false)
    expect(isCaptureView({ ...view, phase: 'invented' }, 'rig-1')).toBe(false)
    expect(isCaptureView({ ...view, elapsedSeconds: Number.NaN }, 'rig-1')).toBe(false)
    expect(isCaptureView({ ...view, exposureSeconds: 0 }, 'rig-1')).toBe(false)
    for (const patch of [{ repeat: 'true' }, { completedCount: -1 }, { completedCount: 1.5 }, { completedCount: undefined }]) {
      expect(isCaptureView({ ...view, ...patch }, 'rig-1')).toBe(false)
    }
  })

  it('rejects unusable images and URLs outside the exact frame resource', () => {
    for (const patch of [
      { imageUrl: 'https://other.example/image.png' },
      { imageUrl: '/api/rigs/other-rig/capture/images/frame-1' },
      { imageUrl: '/api/rigs/rig-1/capture/images/other-frame' },
      { statistics: undefined }, { statistics: { detectedStars: -1, medianHfrPixels: 2 } },
      { statistics: { detectedStars: 0, medianHfrPixels: 2 } }, { statistics: { detectedStars: 2, medianHfrPixels: null } },
      { statistics: { detectedStars: 2.5, medianHfrPixels: 2 } }, { statistics: { detectedStars: 2, medianHfrPixels: NaN } },
      { width: 0 }, { height: 1.5 }, { exposureSeconds: -1 },
      { capturedAt: 'yesterday' }, { receivedAt: '2026-09-05T17:59:00.000Z' },
    ]) expect(isCaptureView({ ...view, latestImage: { ...view.latestImage, ...patch } }, 'rig-1')).toBe(false)
  })
})
