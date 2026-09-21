import * as statistics from '../imaging/statistics.js'
import { expect, it, vi } from 'vitest'
import { inflateSync } from 'node:zlib'
import { CaptureStoppedError, createCaptureController, type CaptureCamera, type CaptureFrame, type CaptureRunOptions } from './controller.js'
import { createMemorySavedImageStore, type SavedImageStore } from '../saved-images/store.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })

  return { promise, resolve, reject }
}

function setup(savedImages: SavedImageStore = createMemorySavedImageStore()) {
  const requests: Array<Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>> = []

  const camera: CaptureCamera = {
    capture(input) {
      const result = deferred<CaptureFrame>()
      requests.push({ ...input, ...result })

      return result.promise
    },
  }

  const actual = createCaptureController({ rigId: 'fra 400', rigName: 'FRA 400' }, () => Date.parse('2026-09-05T16:00:10Z'), savedImages)
  const controller = { ...actual, start: (seconds: number, options: CaptureRunOptions = {}) => actual.start(seconds, camera, 'Main camera', options) }
  const frame: CaptureFrame = { width: 4, height: 2, pixels: [0, 100, 500, 1000, 500, 0, 200, 100], capturedAt: '2026-09-05T16:00:00Z' }

  async function complete(seconds = 10) {
    await controller.start(seconds)
    requests.at(-1)!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    return controller.snapshot().latestImage!
  }

  return { controller, requests, frame, complete, savedImages }
}

it('owns one pending exposure, publishes a native PNG only after acquisition, and releases its lease', async () => {
  const { controller, requests, frame } = setup()
  const settled = vi.fn(() => expect(controller.active()).toBe(false))
  expect(await controller.start(10, { onSettled: settled })).toMatchObject({ active: true, phase: 'exposing', latestImage: null })
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

it('keeps the same pending exposure, previous image and run lease through interrupted and recovered reads', async () => {
  const { controller, requests, frame } = setup()
  const settled = vi.fn()
  await controller.start(10, { repeat: true, onSettled: settled })
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  const previous = controller.snapshot().latestImage
  const pending = requests[1]!
  pending.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  pending.onReadState('retrying')
  expect(controller.snapshot()).toMatchObject({ active: true, phase: 'reading', captureReadState: 'retrying', completedCount: 1, latestImage: previous })
  expect(settled).not.toHaveBeenCalled()
  pending.onReadState('current')
  expect(controller.snapshot()).toMatchObject({ active: true, phase: 'reading', captureReadState: 'current', completedCount: 1, latestImage: previous })
  expect(requests).toHaveLength(2)
  pending.resolve({ ...frame, capturedAt: '2026-09-05T16:01:00Z' })
  await vi.waitFor(() => expect(requests).toHaveLength(3))
  pending.onReadState('retrying')
  pending.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect(controller.snapshot()).toMatchObject({ phase: 'exposing', captureReadState: 'current', elapsedSeconds: 0, completedCount: 2,
    latestImage: { capturedAt: '2026-09-05T16:01:00Z' } })
  const stopping = controller.stop()
  requests[2]!.reject(new CaptureStoppedError())
  await stopping
  expect(settled).toHaveBeenCalledOnce()
})

it.each([
  { rejection: new CaptureStoppedError(), phase: 'stopped', error: null },
  { rejection: new Error('Camera cleanup unconfirmed'), phase: 'failed', error: 'Camera cleanup unconfirmed' },
  { rejection: new DOMException('Unconfirmed abort', 'AbortError'), phase: 'failed', error: 'Unconfirmed abort' },
])('waits for cleanup and reports $phase for $rejection.name', async ({ rejection, phase, error }) => {
  const { controller, requests } = setup()
  const released = vi.fn()
  await controller.start(10, { onSettled: released })
  requests[0]!.onReadState('retrying')
  const stop = controller.stop()
  let settled = false
  void stop.then(() => { settled = true })
  await Promise.resolve()
  expect(requests[0]!.signal.aborted).toBe(true)
  expect(settled).toBe(false)
  expect(controller.snapshot()).toMatchObject({ phase: 'stopping', active: true, captureReadState: 'current' })
  expect(released).not.toHaveBeenCalled()
  requests[0]!.onReadState('retrying')
  requests[0]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect(controller.snapshot().phase).toBe('stopping')
  await expect(controller.start(10)).rejects.toThrow('already running')
  requests[0]!.reject(rejection)
  expect(await stop).toMatchObject({ phase, error, active: false, captureReadState: 'current' })
  requests[0]!.onReadState('retrying')
  expect(controller.snapshot().captureReadState).toBe('current')
  expect(released).toHaveBeenCalledOnce()
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
  await controller.start(10, { onSettled: settled, repeat: true })
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
  await controller.start(10, { onSettled: settled, repeat: true })
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

it('keeps the selected completed frame with exact data and preview without saving future frames', async () => {
  const { controller, complete, savedImages, frame } = setup()
  const selected = await complete(10)
  const latest = await complete(20)
  expect(await savedImages.count('fra 400')).toBe(0)
  const saved = await controller.keep(selected.id)
  expect(saved).toMatchObject({ id: selected.id, exposureSeconds: 10, saved: true })
  expect(controller.snapshot().latestImage).toEqual(latest)
  expect(await savedImages.file('fra 400', selected.id, 'native')).toEqual(controller.image(selected.id))
  const fits = (await savedImages.file('fra 400', selected.id, 'fits'))!
  expect(fits.readInt32BE(2880 + 4)).toBe(frame.pixels[1])
  expect((await controller.keep(selected.id))?.id).toBe(selected.id)
  await complete(30)
  expect(await savedImages.count('fra 400')).toBe(1)
  expect(controller.snapshot()).toMatchObject({ saveFrames: false, savedImageCount: 1, latestImage: { saved: false } })
})

it('saves every repeated frame before exposing again, including a completed frame during Stop', async () => {
  const store = createMemorySavedImageStore()
  const gate = deferred<void>()
  const original = store.save.bind(store)
  const save = vi.spyOn(store, 'save')
  save.mockImplementationOnce(async (...args) => {
    await gate.promise

    return original(...args)
  })
  const { controller, requests, frame } = setup(store)
  await controller.start(10, { repeat: true, saveFrames: true })
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
  expect(requests).toHaveLength(1)
  expect(controller.snapshot()).toMatchObject({ active: true, latestImage: { saved: false } })
  gate.resolve()
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(controller.snapshot().latestImage?.saved).toBe(true)
  const stopping = controller.stop()
  requests[1]!.resolve(frame)
  expect(await stopping).toMatchObject({ active: false, completedCount: 2, latestImage: { saved: true } })
  expect(await store.count('fra 400')).toBe(2)
})

it('stops on an automatic save failure and retains that frame for an explicit retry', async () => {
  const store = createMemorySavedImageStore()
  vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('Disk full'))
  const { controller, requests, frame } = setup(store)
  await controller.start(10, { repeat: true, saveFrames: true })
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(requests).toHaveLength(1)
  expect(controller.snapshot()).toMatchObject({ phase: 'failed', completedCount: 1, latestImage: { saved: false } })
  expect(controller.snapshot().error).toContain('Disk full')
  const id = controller.snapshot().latestImage!.id
  expect(await controller.keep(id)).toMatchObject({ id, saved: true })
  expect(controller.snapshot().latestImage?.saved).toBe(true)
  expect(await store.count('fra 400')).toBe(1)
})

it('bounds unsaved frame availability but keeps saved frames idempotent after eviction', async () => {
  const { controller, complete } = setup()
  const expired = await complete()
  const saved = await complete()
  await controller.keep(saved.id)
  await complete()
  await complete()
  await complete()
  expect(await controller.keep(expired.id)).toBeUndefined()
  expect(await controller.keep(saved.id)).toMatchObject({ id: saved.id, saved: true })
})

it('preserves an estimated start in the published image, retained metadata and original FITS', async () => {
  const { controller, requests, frame, savedImages } = setup()
  await controller.start(10, { saveFrames: true })
  requests[0]!.resolve({ ...frame, capturedAtSource: 'server-estimate' })
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const image = controller.snapshot().latestImage!
  expect(image).toMatchObject({ capturedAt: frame.capturedAt, capturedAtSource: 'server-estimate', saved: true })
  expect(await savedImages.get('fra 400', image.id)).toMatchObject({ capturedAt: frame.capturedAt, capturedAtSource: 'server-estimate' })
  const fits = (await savedImages.file('fra 400', image.id, 'fits'))!.toString('ascii', 0, 2880)
  expect(fits).toContain("DATE-OBS= '2026-09-05T16:00:00.000Z'")
  expect(fits).toContain("TIMESRC = 'SERVER-ESTIMATE'")
  expect(fits).toContain('COMMENT DATE-OBS estimated from server UTC before StartExposure.')
})
