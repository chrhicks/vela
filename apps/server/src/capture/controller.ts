import { randomUUID } from 'node:crypto'
import type { CaptureView } from '@vela/model/web'
import { capturePreviews, type ImageColor } from '../imaging/preview.js'
import { measureStars } from '../imaging/statistics.js'

export interface CaptureFrame {
  width: number
  height: number
  pixels: ArrayLike<number>
  capturedAt: string
  color?: ImageColor
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
  settings: { rigId: string, rigName: string },
  now = Date.now,
) {
  let view: CaptureView = {
    rigId: settings.rigId, rigName: settings.rigName, camera: null,
    enabled: true, unavailableReason: null, phase: 'idle', active: false,
    repeat: true, completedCount: 0, exposureSeconds: 2, elapsedSeconds: 0, error: null, latestImage: null,
  }
  let running: Promise<void> | undefined
  let cancellation: AbortController | undefined
  const images = new Map<string, { native: Buffer, fit: Buffer | undefined }>()
  function patch(next: Partial<CaptureView>) { view = { ...view, ...next } }

  async function acquire(exposureSeconds: number, signal: AbortSignal, camera: CaptureCamera, cameraName: string, repeat: boolean) {
    try {
      do {
        patch({ phase: 'exposing', elapsedSeconds: 0 })
        const frame = await camera.capture({ exposureSeconds, signal, onProgress(progress) {
          if (!signal.aborted) patch({ phase: progress.phase, elapsedSeconds: progress.elapsedSeconds })
        } })
        // A completed acquisition wins a race with Stop: publish the actual result.
        if (!signal.aborted) patch({ phase: 'reading' })
        const id = randomUUID()
        const [previews, statistics] = await Promise.all([
          capturePreviews(frame.width, frame.height, frame.pixels, frame.color),
          measureStars(frame.width, frame.height, frame.pixels, frame.color).catch(error => {
            console.warn('Capture image star measurements unavailable', error)
            return null
          }),
        ])
        images.set(id, previews)
        while (images.size > 3) images.delete(images.keys().next().value!)
        patch({ phase: 'complete', completedCount: view.completedCount + 1, elapsedSeconds: exposureSeconds, latestImage: {
          id, imageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}`,
          ...(previews.fit ? { fitImageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}/fit` } : {}),
          width: frame.width, height: frame.height, exposureSeconds,
          capturedAt: frame.capturedAt, receivedAt: new Date(now()).toISOString(), cameraName,
          color: frame.color?.kind === 'bayer' ? 'color' : 'mono', statistics,
        } })
      } while (repeat && !signal.aborted)
    } catch (error) {
      if (signal.aborted && error instanceof CaptureStoppedError) patch({ phase: 'stopped' })
      else patch({ phase: 'failed', error: error instanceof Error ? error.message : 'Exposure failed' })
    } finally {
      patch({ active: false })
    }
  }

  async function start(exposureSeconds: number, camera: CaptureCamera, cameraName: string, onSettled?: () => void, repeat = false) {
    if (running) throw new Error('An exposure is already running')
    if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0) throw new Error('Exposure duration must be positive')
    cancellation = new AbortController()
    patch({ camera: { name: cameraName }, phase: 'exposing', active: true, repeat, completedCount: 0, exposureSeconds, elapsedSeconds: 0, error: null })
    running = acquire(exposureSeconds, cancellation.signal, camera, cameraName, repeat).finally(() => {
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

  return { start, stop, snapshot: () => view, image: (id: string) => images.get(id)?.native,
    fitImage: (id: string) => images.get(id)?.fit, active: () => !!running }
}
