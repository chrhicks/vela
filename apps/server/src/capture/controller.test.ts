import * as statistics from '../imaging/statistics.js'
import { expect, it, vi } from 'vitest'
import { inflateSync } from 'node:zlib'
import { CaptureStoppedError, createCaptureController, type CaptureCamera, type CaptureFrame } from './controller.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const requests: Array<Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>> = []
  const camera: CaptureCamera = {
    capture(input) {
      const result = deferred<CaptureFrame>()
      requests.push({ ...input, ...result })
      return result.promise
    },
  }
  const actual = createCaptureController({ rigId: 'fra 400', rigName: 'FRA 400' }, () => Date.parse('2026-09-05T16:00:10Z'))
  const controller = { ...actual, start: (seconds: number, settled?: () => void, repeat = false) => actual.start(seconds, camera, 'Main camera', settled, repeat) }
  const frame: CaptureFrame = { width: 4, height: 2, pixels: [0, 100, 500, 1000, 500, 0, 200, 100], capturedAt: '2026-09-05T16:00:00Z' }
  async function complete(seconds = 10) {
    await controller.start(seconds)
    requests.at(-1)!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    return controller.snapshot().latestImage!
  }
  return { controller, requests, frame, complete }
}

it('owns one pending exposure, publishes a native PNG only after acquisition, and releases its lease', async () => {
  const { controller, requests, frame } = setup()
  const settled = vi.fn(() => expect(controller.active()).toBe(false))
  expect(await controller.start(10, settled)).toMatchObject({ active: true, phase: 'exposing', latestImage: null })
  expect(settled).not.toHaveBeenCalled()
  await expect(controller.start(20)).rejects.toThrow('already running')
  expect(requests).toHaveLength(1)
  requests[0]!.onProgress({ phase: 'exposing', elapsedSeconds: 3 })
  expect(controller.snapshot()).toMatchObject({ phase: 'exposing', elapsedSeconds: 3, latestImage: null })
  requests[0]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect(controller.snapshot().phase).toBe('reading')
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(settled).toHaveBeenCalledOnce()
  const view = controller.snapshot()
  expect(view).toMatchObject({ phase: 'complete', active: false, error: null, latestImage: {
    width: 4, height: 2, exposureSeconds: 10, capturedAt: frame.capturedAt,
    receivedAt: '2026-09-05T16:00:10.000Z', cameraName: 'Main camera',
  } })
  const png = controller.image(view.latestImage!.id)!
  expect(view.latestImage!.imageUrl).toBe(`/api/rigs/fra%20400/capture/images/${view.latestImage!.id}`)
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(png.readUInt32BE(16)).toBe(4)
  expect(png.readUInt32BE(20)).toBe(2)
  const idatLength = png.readUInt32BE(33)
  expect(inflateSync(png.subarray(41, 41 + idatLength))).toHaveLength(10)
})

it('retains the prior image and its metadata during a subsequent failed exposure', async () => {
  const { controller, requests, complete } = setup()
  const previous = await complete()
  await controller.start(30)
  expect(controller.snapshot()).toMatchObject({ active: true, exposureSeconds: 30, latestImage: previous })
  requests.at(-1)!.reject(new Error('Camera readout failed'))
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', error: 'Camera readout failed', latestImage: previous })
  expect(controller.image(previous.id)).toBeDefined()
})

it.each([
  { rejection: new CaptureStoppedError(), phase: 'stopped', error: null },
  { rejection: new Error('Camera cleanup unconfirmed'), phase: 'failed', error: 'Camera cleanup unconfirmed' },
  { rejection: new DOMException('Unconfirmed abort', 'AbortError'), phase: 'failed', error: 'Unconfirmed abort' },
])('waits for cleanup and reports $phase for $rejection.name', async ({ rejection, phase, error }) => {
  const { controller, requests } = setup()
  await controller.start(10)
  const stop = controller.stop()
  let settled = false
  void stop.then(() => { settled = true })
  await Promise.resolve()
  expect(requests[0]!.signal.aborted).toBe(true)
  expect(settled).toBe(false)
  expect(controller.snapshot()).toMatchObject({ phase: 'stopping', active: true })
  requests[0]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect(controller.snapshot().phase).toBe('stopping')
  await expect(controller.start(10)).rejects.toThrow('already running')
  requests[0]!.reject(rejection)
  expect(await stop).toMatchObject({ phase, error, active: false })
})

it('keeps an exposure that actually completed while Stop was being requested', async () => {
  const { controller, requests, frame } = setup()
  await controller.start(10)
  const stop = controller.stop()
  requests[0]!.resolve(frame)
  expect(await stop).toMatchObject({ phase: 'complete', active: false, latestImage: { capturedAt: frame.capturedAt } })
})

it('bounds image retention while preserving the newest image', async () => {
  const { controller, complete } = setup()
  const oldest = await complete()
  const retained = await complete()
  await complete()
  const newest = await complete()
  expect(controller.image(oldest.id)).toBeUndefined()
  expect(controller.image(retained.id)).toBeDefined()
  expect(controller.image(newest.id)).toBeDefined()
  expect(controller.snapshot().latestImage).toBe(newest)
})

it('publishes Bayer acquisition as a color PNG with matching image metadata', async () => {
  const { controller, requests, frame } = setup()
  await controller.start(2)
  requests[0]!.resolve({ ...frame, color: { kind: 'bayer', pattern: 'rggb' } })
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const image = controller.snapshot().latestImage!
  expect(image.color).toBe('color')
  expect(controller.image(image.id)![25]).toBe(2)
})

it('repeats completed exposures under one lease and keeps the last frame and count after failure', async () => {
  const { controller, requests, frame } = setup()
  const settled = vi.fn()
  expect(controller.snapshot()).toMatchObject({ repeat: true, completedCount: 0 })
  await controller.start(10, settled, true)
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  const previous = controller.snapshot().latestImage!
  expect(controller.snapshot()).toMatchObject({ active: true, phase: 'exposing', repeat: true, completedCount: 1, elapsedSeconds: 0 })
  expect(settled).not.toHaveBeenCalled()
  requests[1]!.reject(new Error('Readout failed'))
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', completedCount: 1, latestImage: previous, error: 'Readout failed' })
  expect(settled).toHaveBeenCalledOnce()
  await controller.start(20)
  expect(controller.snapshot()).toMatchObject({ repeat: false, completedCount: 0, latestImage: previous })
  const stopping = controller.stop()
  requests[2]!.reject(new CaptureStoppedError())
  await stopping
})

it.each(['readout', 'preview'] as const)('stops during %s without another exposure and publishes a frame that wins the race', async phase => {
  const { controller, requests, frame } = setup()
  const settled = vi.fn()
  await controller.start(10, settled, true)
  requests[0]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  if (phase === 'preview') {
    requests[0]!.resolve(frame)
    // Acquisition has completed, while asynchronous PNG compression is pending.
    await Promise.resolve()
  }
  expect(controller.snapshot().phase).toBe('reading')
  const stopping = controller.stop()
  expect(controller.snapshot()).toMatchObject({ phase: 'stopping', active: true, completedCount: 0 })
  expect(settled).not.toHaveBeenCalled()
  requests[0]!.resolve(frame)
  expect(await stopping).toMatchObject({ phase: 'complete', active: false, completedCount: 1, latestImage: { capturedAt: frame.capturedAt } })
  expect(requests).toHaveLength(1)
  expect(settled).toHaveBeenCalledOnce()
})


it('retains an acquired image when optional star analysis is unavailable', async () => {
  const measure = vi.spyOn(statistics, 'measureStars').mockRejectedValueOnce(new Error('Analysis failed'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const { controller, complete } = setup()
    await complete()
    expect(controller.snapshot()).toMatchObject({ phase: 'complete', completedCount: 1, latestImage: { statistics: null } })
  } finally {
    measure.mockRestore()
    warning.mockRestore()
  }
})
