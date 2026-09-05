import { randomUUID } from 'node:crypto'
import type { CaptureView } from '@vela/model/web'
import { previewPng } from '../imaging/preview.js'

export interface CaptureFrame {
  width: number
  height: number
  pixels: ArrayLike<number>
  capturedAt: string
}

export interface CaptureProgress {
  phase: 'exposing' | 'reading'
  elapsedSeconds: number
}

export interface CaptureCamera {
  capture(input: {
    exposureSeconds: number
    signal: AbortSignal
    onProgress: (progress: CaptureProgress) => void
  }): Promise<CaptureFrame>
}

/** Only the acquisition boundary can confirm cancellation finished cleanup. */
export class CaptureStoppedError extends Error {
  constructor() {
    super('Exposure stopped')
    this.name = 'CaptureStoppedError'
  }
}

export function createCaptureController(
  settings: { rigId: string, rigName: string, cameraName: string },
  camera: CaptureCamera,
  now = Date.now,
) {
  let view: CaptureView = {
    rigId: settings.rigId, rigName: settings.rigName, camera: { name: settings.cameraName },
    enabled: true, unavailableReason: null, phase: 'idle', active: false,
    exposureSeconds: 2, elapsedSeconds: 0, error: null, latestImage: null,
  }
  let running: Promise<void> | undefined
  let cancellation: AbortController | undefined
  const images = new Map<string, Buffer>()
  function patch(next: Partial<CaptureView>) { view = { ...view, ...next } }

  async function acquire(exposureSeconds: number, signal: AbortSignal) {
    try {
      const frame = await camera.capture({ exposureSeconds, signal, onProgress(progress) {
        if (!signal.aborted) patch({ phase: progress.phase, elapsedSeconds: progress.elapsedSeconds })
      } })
      // A completed acquisition wins a race with Stop: publish the actual result.
      patch({ phase: 'reading' })
      const id = randomUUID()
      const png = previewPng(frame.width, frame.height, frame.pixels)
      images.set(id, png)
      while (images.size > 3) images.delete(images.keys().next().value!)
      patch({ phase: 'complete', elapsedSeconds: exposureSeconds, latestImage: {
        id, imageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}`,
        width: frame.width, height: frame.height, exposureSeconds,
        capturedAt: frame.capturedAt, receivedAt: new Date(now()).toISOString(), cameraName: settings.cameraName,
      } })
    } catch (error) {
      if (signal.aborted && error instanceof CaptureStoppedError) patch({ phase: 'stopped' })
      else patch({ phase: 'failed', error: error instanceof Error ? error.message : 'Exposure failed' })
    } finally {
      patch({ active: false })
    }
  }

  async function start(exposureSeconds: number, onSettled?: () => void) {
    if (running) throw new Error('An exposure is already running')
    if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0) throw new Error('Exposure duration must be positive')
    cancellation = new AbortController()
    patch({ phase: 'exposing', active: true, exposureSeconds, elapsedSeconds: 0, error: null })
    running = acquire(exposureSeconds, cancellation.signal).finally(() => {
      running = undefined
      onSettled?.()
    })
    return view
  }

  async function stop() {
    if (running) {
      patch({ phase: 'stopping' })
      cancellation!.abort()
      await running
    }
    return view
  }

  return { start, stop, snapshot: () => view, image: (id: string) => images.get(id), active: () => !!running }
}
