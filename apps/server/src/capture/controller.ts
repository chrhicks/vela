import { randomUUID } from 'node:crypto'
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api'
import type { CaptureImage, CaptureSubject, CaptureView } from '@vela/model/web'
import { capturePreviews, type ImageColor } from '../imaging/preview.js'
import { measureStars } from '../imaging/statistics.js'
import { PREVIEW_VERSION } from '../imaging/background.js'
import { encodeCaptureFits } from '../imaging/fits.js'
import {
  createMemorySavedImageStore,
  type SavedImageStore,
  type SavedImageFiles,
} from '../saved-images/store.js'

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

/** The exposure finished but its frame was lost before it could be fetched. */
export class CaptureFrameLostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureFrameLostError'
  }
}

export interface CaptureRunOptions {
  subject?: CaptureSubject | null
  onSettled?: () => void
  repeat?: boolean
  saveFrames?: boolean
}

const tracer = trace.getTracer('vela.capture')

export function createCaptureController(
  settings: { rigId: string; rigName: string },
  now = Date.now,
  savedImages: SavedImageStore = createMemorySavedImageStore(),
) {
  let view: CaptureView = {
    rigId: settings.rigId,
    rigName: settings.rigName,
    camera: null,
    enabled: true,
    unavailableReason: null,
    phase: 'idle',
    active: false,
    captureReadState: 'current',
    repeat: true,
    saveFrames: false,
    savedImageCount: 0,
    completedCount: 0,
    lostFrameCount: 0,
    subject: null,
    savedCount: 0,
    integrationSeconds: 0,
    exposureSeconds: 2,
    elapsedSeconds: 0,
    error: null,
    latestImage: null,
    cooling: null,
  }

  let generation = 0
  let running: Promise<void> | undefined
  let cancellation: AbortController | undefined

  const images = new Map<
    string,
    {
      generation: number
      native: Buffer
      fit: Buffer | undefined
      fits?: Buffer
      metadata: CaptureImage
    }
  >()

  function patch(next: Partial<CaptureView>) {
    view = { ...view, ...next }
  }

  async function keep(imageId: string) {
    const existing = await savedImages.get(settings.rigId, imageId)
    const image = images.get(imageId)

    let saved = existing

    if (!saved) {
      if (!image?.fits) return savedImages.get(settings.rigId, imageId)

      const files: SavedImageFiles = {
        fits: image.fits,
        native: image.native,
        previewVersion: PREVIEW_VERSION,
      }

      saved = await savedImages.save(
        settings.rigId,
        image.metadata,
        image.fit ? { ...files, fit: image.fit } : files,
      )
    }

    if (image && !image.metadata.saved) {
      image.metadata = { ...image.metadata, saved: true }
      // Saved files are now owned by the archive; release the temporary raw copy.
      delete image.fits

      const next = {
        savedImageCount: (view.savedImageCount ?? 0) + 1,
        savedCount: view.savedCount + (image.generation === generation ? 1 : 0),
      }

      patch(view.latestImage?.id === imageId ? { ...next, latestImage: image.metadata } : next)
    }

    return saved
  }

  async function acquire(
    exposureSeconds: number,
    signal: AbortSignal,
    camera: CaptureCamera,
    cameraName: string,
    repeat: boolean,
    saveFrames: boolean,
    subject: CaptureSubject | null,
    runGeneration: number,
  ) {
    let frameSpan: Span | undefined

    // One span per frame, ended exactly once with how the frame turned out.
    function endFrame(outcome: string, failure?: string) {
      if (!frameSpan) return

      frameSpan.setAttribute('capture.frame.outcome', outcome)

      if (failure !== undefined) frameSpan.setStatus({ code: SpanStatusCode.ERROR, message: failure })

      frameSpan.end()
      frameSpan = undefined
    }

    // Records when the camera's reads go from current to retrying and back, and how long they retried.
    function watchReads(span: Span, startedAt: number) {
      let since: number | undefined
      let count = 0
      let retryingMs = 0

      function recover() {
        if (since === undefined) return

        const ms = Math.round(performance.now() - since)
        retryingMs += ms
        span.addEvent('capture.read.recovered', { 'capture.read.retrying.ms': ms })
        since = undefined
      }

      return {
        state(next: CaptureView['captureReadState']) {
          if (next !== 'retrying') recover()
          else if (since === undefined) {
            since = performance.now()
            count++
            span.addEvent('capture.read.retrying', {
              'capture.read.after.ms': Math.round(since - startedAt),
            })
          }
        },
        finish() {
          recover()

          span.setAttributes({
            'capture.read.retrying.count': count,
            'capture.read.retrying.ms': retryingMs,
          })
        },
      }
    }

    try {
      do {
        patch({ phase: 'exposing', elapsedSeconds: 0, captureReadState: 'current' })
        let capturePending = true

        const span = tracer.startSpan('capture.frame', {
          attributes: {
            'capture.rig.id': settings.rigId,
            'capture.frame.index': view.completedCount + (view.lostFrameCount ?? 0) + 1,
            'capture.exposure.seconds': exposureSeconds,
          },
        })

        frameSpan = span
        const frameStartedAt = performance.now()
        const reads = watchReads(span, frameStartedAt)

        let frame: CaptureFrame

        try {
          frame = await camera
            .capture({
              exposureSeconds,
              signal,
              onProgress(progress) {
                if (capturePending && !signal.aborted)
                  patch({ phase: progress.phase, elapsedSeconds: progress.elapsedSeconds })
              },
              onReadState(captureReadState) {
                reads.state(captureReadState)

                if (capturePending && !signal.aborted) patch({ captureReadState })
              },
            })
            .finally(() => {
              capturePending = false
              patch({ captureReadState: 'current' })
            })
        } catch (error) {
          reads.finish()

          if (!(error instanceof CaptureFrameLostError)) throw error

          // A lost frame is one frame, not the run: count it, never expose again to repair it, and
          // take the next frame when the run repeats. A single exposure ends, saying so.
          patch({ lostFrameCount: (view.lostFrameCount ?? 0) + 1 })
          endFrame('lost', error.message)

          if (!repeat || signal.aborted) throw error

          continue
        }

        reads.finish()

        // Exposure plus readout and transfer; the part beyond the exposure is the camera's overhead.
        const acquireMs = performance.now() - frameStartedAt

        span.setAttributes({
          'capture.acquire.ms': Math.round(acquireMs),
          'capture.overhead.ms': Math.round(acquireMs - exposureSeconds * 1000),
        })

        // A completed acquisition wins a race with Stop: publish the actual result.
        if (!signal.aborted) patch({ phase: 'reading' })
        const id = randomUUID()
        const processStartedAt = performance.now()

        const [previews, statistics, fits] = await Promise.all([
          capturePreviews(frame.width, frame.height, frame.pixels, frame.color),
          measureStars(frame.width, frame.height, frame.pixels, frame.color).catch(error => {
            console.warn('Capture image star measurements unavailable', error)

            return null
          }),
          encodeCaptureFits(frame, { exposureSeconds, cameraName }),
        ])

        span.setAttributes({
          'capture.process.ms': Math.round(performance.now() - processStartedAt),
          'capture.fits.bytes': fits.byteLength,
        })

        let metadata: CaptureImage = {
          id,
          subject,
          imageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}`,
          width: frame.width,
          height: frame.height,
          exposureSeconds,
          capturedAt: frame.capturedAt,
          receivedAt: new Date(now()).toISOString(),
          cameraName,
          color: frame.color?.kind === 'bayer' ? 'color' : 'mono',
          statistics,
          saved: false,
        }

        if (previews.fit) {
          metadata = {
            ...metadata,
            fitImageUrl: `/api/rigs/${encodeURIComponent(settings.rigId)}/capture/images/${id}/fit`,
          }
        }

        if (frame.capturedAtSource)
          metadata = { ...metadata, capturedAtSource: frame.capturedAtSource }

        images.set(id, { ...previews, fits, metadata, generation: runGeneration })

        while (images.size > 3) images.delete(images.keys().next().value!)
        patch({
          phase: saveFrames ? 'saving' : 'complete',
          completedCount: view.completedCount + 1,
          integrationSeconds: view.integrationSeconds + exposureSeconds,
          elapsedSeconds: exposureSeconds,
          latestImage: metadata,
        })

        if (saveFrames) {
          const saveStartedAt = performance.now()

          try {
            await keep(id)
          } catch (error) {
            span.setAttribute('capture.save.ms', Math.round(performance.now() - saveStartedAt))
            endFrame('save-failed', error instanceof Error ? error.message : 'Storage unavailable.')

            throw new Error(
              `Image could not be saved. Capture stopped; try keeping the latest image again. ${error instanceof Error ? error.message : 'Storage unavailable.'}`,
            )
          }

          span.setAttribute('capture.save.ms', Math.round(performance.now() - saveStartedAt))
          patch({ phase: 'complete' })
        }

        endFrame(saveFrames ? 'saved' : 'unsaved')
      } while (repeat && !signal.aborted)
    } catch (error) {
      const stopped = signal.aborted && error instanceof CaptureStoppedError

      endFrame(
        stopped ? 'stopped' : 'failed',
        stopped ? undefined : error instanceof Error ? error.message : 'Exposure failed',
      )

      if (stopped) patch({ phase: 'stopped' })
      else
        patch({
          phase: 'failed',
          error: error instanceof Error ? error.message : 'Exposure failed',
        })
    } finally {
      patch({ active: false, captureReadState: 'current' })

      // Bounds a run and totals it, so a long run reads as one line.
      const ended = tracer.startSpan('capture.run.ended', {
        attributes: {
          'capture.rig.id': settings.rigId,
          'capture.run.phase': view.phase,
          'capture.run.completed': view.completedCount,
          'capture.run.lost': view.lostFrameCount ?? 0,
          'capture.run.saved': view.savedCount,
        },
      })

      if (view.error) ended.setAttribute('capture.run.error', view.error)
      ended.end()
    }
  }

  async function start(
    exposureSeconds: number,
    camera: CaptureCamera,
    cameraName: string,
    { onSettled, repeat = false, saveFrames = false, subject = null }: CaptureRunOptions = {},
  ) {
    if (running) throw new Error('An exposure is already running')

    if (!Number.isFinite(exposureSeconds) || exposureSeconds <= 0)
      throw new Error('Exposure duration must be positive')
    const runSubject = subject ? Object.freeze({ ...subject }) : null
    const runGeneration = ++generation
    cancellation = new AbortController()
    patch({
      camera: { name: cameraName },
      phase: 'exposing',
      active: true,
      repeat,
      saveFrames,
      completedCount: 0,
      lostFrameCount: 0,
      subject: runSubject,
      savedCount: 0,
      integrationSeconds: 0,
      exposureSeconds,
      elapsedSeconds: 0,
      error: null,
      captureReadState: 'current',
    })

    tracer
      .startSpan('capture.run.started', {
        attributes: {
          'capture.rig.id': settings.rigId,
          'capture.exposure.seconds': exposureSeconds,
          'capture.run.repeat': repeat,
          'capture.run.saveFrames': saveFrames,
        },
      })
      .end()

    running = acquire(
      exposureSeconds,
      cancellation.signal,
      camera,
      cameraName,
      repeat,
      saveFrames,
      runSubject,
      runGeneration,
    ).finally(() => {
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

  return {
    start,
    stop,
    keep,
    snapshot: () => view,
    image: (id: string) => images.get(id)?.native,
    fitImage: (id: string) => images.get(id)?.fit,
    active: () => !!running,
  }
}
