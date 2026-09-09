import { describe, expect, it } from 'vitest'
import type { CaptureView } from '@vela/model/web'
import { isCaptureView, isSavedImage, isSavedImagesView } from './validation'

const view: CaptureView = {
  rigId: 'rig-1', rigName: 'Offline rig', camera: { name: 'Simulator Camera' }, enabled: true,
  unavailableReason: null, phase: 'exposing', active: true, exposureSeconds: 10, elapsedSeconds: 2,
  error: null, saveFrames: false, savedImageCount: 0, repeat: true, completedCount: 1,
  latestImage: {
    id: 'frame-1', saved: false, imageUrl: '/api/rigs/rig-1/capture/images/frame-1', width: 1600, height: 1200,
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

const savedImage = { ...view.latestImage!, saved: true, rigId: 'rig-1', savedAt: '2026-09-05T18:00:04.000Z',
  imageUrl: '/api/rigs/rig-1/saved-images/frame-1/preview', fitImageUrl: '/api/rigs/rig-1/saved-images/frame-1/fit',
  fitsUrl: '/api/rigs/rig-1/saved-images/frame-1/fits', previewDownloadUrl: '/api/rigs/rig-1/saved-images/frame-1/download-preview' }

it('validates confirmed retention and exact same-origin download resources', () => {
  expect(isSavedImage(savedImage, 'rig-1')).toBe(true)
  for (const patch of [{ saved: false }, { rigId: 'other' }, { fitsUrl: 'https://example.com/file.fits' }, { previewDownloadUrl: '/api/rigs/other/saved-images/frame-1/download-preview' }, { savedAt: 'invalid' }]) {
    expect(isSavedImage({ ...savedImage, ...patch }, 'rig-1')).toBe(false)
  }
  expect(isSavedImagesView({ rigId: 'rig-1', rigName: 'Rig', images: [savedImage] }, 'rig-1')).toBe(true)
  expect(isSavedImagesView({ rigId: 'rig-1', rigName: 'Rig', images: [savedImage, savedImage] }, 'rig-1')).toBe(false)
  expect(isCaptureView({ ...view, savedImageCount: null }, 'rig-1')).toBe(true)
  expect(isCaptureView({ ...view, phase: 'saving', saveFrames: true }, 'rig-1')).toBe(true)
  for (const patch of [{ saveFrames: undefined }, { savedImageCount: -1 }, { savedImageCount: undefined }, { savedImageCount: 0.5 }]) {
    expect(isCaptureView({ ...view, ...patch }, 'rig-1')).toBe(false)
  }
})

it('accepts legacy and known start sources and rejects unknown sources for live and saved images', () => {
  for (const capturedAtSource of [undefined, 'camera', 'server-estimate', 'unknown', null, 1]) {
    const accepted = capturedAtSource === undefined || capturedAtSource === 'camera' || capturedAtSource === 'server-estimate'
    expect(isCaptureView({ ...view, latestImage: { ...view.latestImage, capturedAtSource } }, 'rig-1')).toBe(accepted)
    expect(isSavedImage({ ...savedImage, capturedAtSource }, 'rig-1')).toBe(accepted)
  }
})
