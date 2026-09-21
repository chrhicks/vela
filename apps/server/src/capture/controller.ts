import { randomUUID } from 'node:crypto'
import type { CaptureImage, CaptureView } from '@vela/model/web'
import { capturePreviews, type ImageColor } from '../imaging/preview.js'
import { measureStars } from '../imaging/statistics.js'
import { encodeCaptureFits } from '../imaging/fits.js'
import { createMemorySavedImageStore, type SavedImageStore } from '../saved-images/store.js'

export interface CaptureFrame {
  width: number
  height: number
  pixels: ArrayLike<number>
  capturedAt: string
  capturedAtSource?: CaptureImage['capturedAtSource']
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
    onReadState: (state: CaptureView['captureReadState']) => void
  }): Promise<CaptureFrame>
}

/** Only the acquisition boundary can confirm cancellation finished cleanup. */
export class CaptureStoppedError extends Error {
  constructor() {
    super('Exposure stopped')
    this.name = 'CaptureStoppedError'
  }
}

export interface CaptureRunOptions {
  onSettled?: () => void
  repeat?: boolean
  saveFrames?: boolean
}

export function createCaptureController(
  settings: { rigId: string, rigName: string },
  now = Date.now,
  savedImages: SavedImageStore = createMemorySavedImageStore(),
) {
  let view: CaptureView = {
    rigId: settings.rigId, rigName: settings.rigName, camera: null,
    enabled: true, unavailableReason: null, phase: 'idle', active: false,
    captureReadState: 'current',
    repeat: true, saveFrames: false, savedImageCount: 0, completedCount: 0, exposureSeconds: 2, elapsedSeconds: 0, error: null, latestImage: null, cooling: null,
  }

  let running: Promise<void> | undefined
  let cancellation: AbortController | undefined
  const images = new Map<string, { native: Buffer, fit: Buffer | undefined, fits?: Buffer, metadata: CaptureImage }>()

  function patch(next: Partial<CaptureView>) { view = { ...view, ...next } }

  async function keep(imageId: string) {
    const existing = await savedImages.get(settings.rigId, imageId)
    const image = images.get(imageId)

    let saved = existing

    if (!saved) {
      if (!image?.fits) return savedImages.get(settings.rigId, imageId)
      const files = { fits: image.fits, native: image.native }
      saved = await savedImages.save(settings.rigId, image.metadata, image.fit ? { ...files, fit: image.fit } : files)
    }

    if (image && !image.metadata.saved) {
      image.metadata = { ...image.metadata, saved: true }
      // Saved files are now owned by the archive; release the temporary raw copy.
      delete image.fits
      const next = { savedImageCount: (view.savedImageCount ?? 0) + 1 }
      patch(view.latestImage?.id === imageId ? { ...next, latestImage: image.metadata } : next)
    }

    return saved
  }

  async function acquire(exposureSeconds: number, signal: AbortSignal, camera: CaptureCamera, cameraName: string, repeat: boolean, saveFrames: boolean) {
    try {
      do {
        patch({ phase: 'exposing', elapsedSeconds: 0, captureReadState: 'current' })
        let capturePending = true

        const frame = await camera.capture({ exposureSeconds, signal, onProgress(progress) {
          if (capturePending && !signal.aborted) patch({ phase: progress.phase, elapsedSeconds: progress.elapsedSeconds })
        }, onReadState(captureReadState) {
          if (capturePending && !signal.aborted) patch({ captureReadState })
        } }).finally(() => {
          capturePending = false
          patch({ captureReadState: 'current' })
        })

        // A completed acquisition wins a race with Stop: publish the actual result.
        if (!signal.aborted) patch({ phase: 'reading' })
        const id = randomUUID()

        const [previews, statistics, fits] = await Promise.all([
          capturePreviews(frame.width, frame.height, frame.pixels, frame.color),
          measureStars(frame.width, frame.height, frame.pixels, frame.color).catch(error => {
            console.warn('Capture image star measurements unavailable', error)

            return null
          }),
          encodeCaptureFits(frame, { exposureSeconds, cameraName }),
        ])

        let metadata: CaptureImage = {
          id, imageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}`,
          width: frame.width, height: frame.height, exposureSeconds,
          capturedAt: frame.capturedAt, receivedAt: new Date(now()).toISOString(), cameraName,
          color: frame.color?.kind === 'bayer' ? 'color' : 'mono', statistics, saved: false,
        }

        if (previews.fit) metadata = { ...metadata, fitImageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}/fit` }

        if (frame.capturedAtSource) metadata = { ...metadata, capturedAtSource: frame.capturedAtSource }

        images.set(id, { ...previews, fits, metadata })

        while (images.size > 3) images.delete(images.keys().next().value!)
        patch({ phase: saveFrames ? 'saving' : 'complete', completedCount: view.completedCount + 1, elapsedSeconds: exposureSeconds, latestImage: metadata })

        if (saveFrames) {
          try { await keep(id) }
          catch (error) {
            throw new Error(`Image could not be saved. Capture stopped; try keeping the latest image again. ${error instanceof Error ? error.message : 'Storage unavailable.'}`)
          }

          patch({ phase: 'complete' })
        }
      } while (repeat && !signal.aborted)
    } catch (error) {
      if (signal.aborted && error instanceof CaptureStoppedError) patch({ phase: 'stopped' })
      else patch({ phase: 'failed', error: error instanceof Error ? error.message : 'Exposure failed' })
    } finally {
      patch({ active: false, captureReadState: 'current' })
    }
  }

  async function start(exposureSeconds: number, camera: CaptureCamera, cameraName: string, { onSettled, repeat = false, saveFrames = false }: CaptureRunOptions = {}) {
    if (running) throw new Error('An exposure is already running')

    if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0) throw new Error('Exposure duration must be positive')
    cancellation = new AbortController()
    patch({ camera: { name: cameraName }, phase: 'exposing', active: true, repeat, saveFrames, completedCount: 0, exposureSeconds, elapsedSeconds: 0, error: null, captureReadState: 'current' })
    running = acquire(exposureSeconds, cancellation.signal, camera, cameraName, repeat, saveFrames).finally(() => {
      running = undefined
      onSettled?.()
    })

    return view
  }

  async function stop() {
    if (running) {
      patch({ phase: 'stopping', captureReadState: 'current' })
      cancellation!.abort()
      await running
    }

    return view
  }

  return { start, stop, keep, snapshot: () => view, image: (id: string) => images.get(id)?.native,
    fitImage: (id: string) => images.get(id)?.fit, active: () => !!running }
}
