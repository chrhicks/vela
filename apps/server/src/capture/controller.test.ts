import * as statistics from '../imaging/statistics.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { inflateSync } from 'node:zlib'
import {
  CaptureFrameLostError,
  CaptureStoppedError,
  CaptureUncertainError,
  createCaptureController,
  type CaptureCamera,
  type CaptureFrame,
  type CaptureRunOptions,
} from './controller.js'
import type { FrameType } from '@vela/model/web'
import { createMemorySavedImageStore, type SavedImageStore } from '../saved-images/store.js'
import type { FrameRecord, FrameRecords } from './frame-records.js'
import { createMemoryCaptureRunStore, type CaptureRunStore } from './run-store.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void

  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

function setup(
  savedImages: SavedImageStore = createMemorySavedImageStore(),
  frameRecords?: FrameRecords,
  runs?: CaptureRunStore,
  biasExposureSeconds?: CaptureCamera['biasExposureSeconds'],
  frameSettings?: CaptureCamera['frameSettings'],
) {
  const requests: Array<
    Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>
  > = []

  const camera: CaptureCamera = {
    capture(input) {
      const result = deferred<CaptureFrame>()
      requests.push({ ...input, ...result })

      return result.promise
    },
    ...(biasExposureSeconds && { biasExposureSeconds }),
    ...(frameSettings && { frameSettings }),
  }

  const actual = createCaptureController(
    { rigId: 'fra 400', rigName: 'FRA 400' },
    () => Date.parse('2026-09-05T16:00:10Z'),
    savedImages,
    frameRecords,
    undefined,
    runs,
  )

  const controller = {
    ...actual,
    start: (seconds: number, options: CaptureRunOptions = {}) =>
      actual.start(seconds, camera, 'Main camera', options),
  }

  const frame: CaptureFrame = {
    width: 4,
    height: 2,
    pixels: [0, 100, 500, 1000, 500, 0, 200, 100],
    capturedAt: '2026-09-05T16:00:00Z',
  }

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
  expect(await controller.start(10, { onSettled: settled })).toMatchObject({
    active: true,
    phase: 'exposing',
    latestImage: null,
  })
  expect(settled).not.toHaveBeenCalled()
  await expect(controller.start(20)).rejects.toThrow('already running')
  expect(requests).toHaveLength(1)
  requests[0]!.onProgress({ phase: 'exposing', elapsedSeconds: 3 })
  expect(controller.snapshot()).toMatchObject({
    phase: 'exposing',
    elapsedSeconds: 3,
    latestImage: null,
  })
  requests[0]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect(controller.snapshot().phase).toBe('reading')
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(settled).toHaveBeenCalledOnce()
  const view = controller.snapshot()
  expect(view).toMatchObject({
    phase: 'complete',
    active: false,
    error: null,
    latestImage: {
      width: 4,
      height: 2,
      exposureSeconds: 10,
      capturedAt: frame.capturedAt,
      receivedAt: '2026-09-05T16:00:10.000Z',
      cameraName: 'Main camera',
    },
  })
  const png = controller.image(view.latestImage!.id)!
  expect(view.latestImage!.imageUrl).toBe(
    `/api/rigs/fra%20400/capture/images/${view.latestImage!.id}`,
  )
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
  expect(controller.snapshot()).toMatchObject({
    active: true,
    exposureSeconds: 30,
    latestImage: previous,
  })
  requests.at(-1)!.reject(new Error('Camera readout failed'))
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    error: 'Camera readout failed',
    latestImage: previous,
  })
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
  expect(controller.snapshot()).toMatchObject({
    active: true,
    phase: 'reading',
    captureReadState: 'retrying',
    completedCount: 1,
    latestImage: previous,
  })
  expect(settled).not.toHaveBeenCalled()
  pending.onReadState('current')
  expect(controller.snapshot()).toMatchObject({
    active: true,
    phase: 'reading',
    captureReadState: 'current',
    completedCount: 1,
    latestImage: previous,
  })
  expect(requests).toHaveLength(2)
  pending.resolve({ ...frame, capturedAt: '2026-09-05T16:01:00Z' })
  await vi.waitFor(() => expect(requests).toHaveLength(3))
  pending.onReadState('retrying')
  pending.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect(controller.snapshot()).toMatchObject({
    phase: 'exposing',
    captureReadState: 'current',
    elapsedSeconds: 0,
    completedCount: 2,
    latestImage: { capturedAt: '2026-09-05T16:01:00Z' },
  })
  const stopping = controller.stop()
  requests[2]!.reject(new CaptureStoppedError())
  await stopping
  expect(settled).toHaveBeenCalledOnce()
})

it.each([
  { rejection: new CaptureStoppedError(), phase: 'stopped', error: null },
  {
    rejection: new Error('Camera cleanup unconfirmed'),
    phase: 'failed',
    error: 'Camera cleanup unconfirmed',
  },
  {
    rejection: new DOMException('Unconfirmed abort', 'AbortError'),
    phase: 'failed',
    error: 'Unconfirmed abort',
  },
])(
  'waits for cleanup and reports $phase for $rejection.name',
  async ({ rejection, phase, error }) => {
    const { controller, requests } = setup()
    const released = vi.fn()
    await controller.start(10, { onSettled: released })
    requests[0]!.onReadState('retrying')
    const stop = controller.stop()
    let settled = false
    void stop.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(requests[0]!.signal.aborted).toBe(true)
    expect(settled).toBe(false)
    expect(controller.snapshot()).toMatchObject({
      phase: 'stopping',
      active: true,
      captureReadState: 'current',
    })
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
  },
)

it('keeps an exposure that actually completed while Stop was being requested', async () => {
  const { controller, requests, frame } = setup()
  await controller.start(10)
  const stop = controller.stop()
  requests[0]!.resolve(frame)
  expect(await stop).toMatchObject({
    phase: 'complete',
    active: false,
    latestImage: { capturedAt: frame.capturedAt },
  })
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
  expect(controller.snapshot()).toMatchObject({
    active: true,
    phase: 'exposing',
    repeat: true,
    completedCount: 1,
    elapsedSeconds: 0,
  })
  expect(settled).not.toHaveBeenCalled()
  requests[1]!.reject(new Error('Readout failed'))
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    completedCount: 1,
    latestImage: previous,
    error: 'Readout failed',
  })
  expect(settled).toHaveBeenCalledOnce()
  await controller.start(20)
  expect(controller.snapshot()).toMatchObject({
    repeat: false,
    completedCount: 0,
    latestImage: previous,
  })
  const stopping = controller.stop()
  requests[2]!.reject(new CaptureStoppedError())
  await stopping
})

it('counts a lost frame and takes the next one while the run repeats', async () => {
  const { controller, requests, frame } = setup()
  await controller.start(10, { repeat: true })
  requests[0]!.reject(new CaptureFrameLostError('Cria no longer holds this image; the frame is lost'))
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(controller.snapshot()).toMatchObject({
    active: true,
    phase: 'exposing',
    completedCount: 0,
    lostFrameCount: 1,
    error: null,
  })
  requests[1]!.resolve(frame)
  await vi.waitFor(() => expect(requests).toHaveLength(3))
  expect(controller.snapshot()).toMatchObject({ active: true, completedCount: 1, lostFrameCount: 1 })
  const stopping = controller.stop()
  requests[2]!.reject(new CaptureStoppedError())
  await stopping
})

describe('frame count', () => {
  it('ends the run cleanly after exactly N finished frames, with N records and no error', async () => {
    const records: FrameRecord[] = []
    const settled = vi.fn()
    const { controller, requests, frame } = setup(createMemorySavedImageStore(), { append: record => void records.push(record), close: async () => {} })
    await controller.start(10, { repeat: true, frameCount: 2, onSettled: settled })
    expect(controller.snapshot().frameCount).toBe(2)
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(controller.snapshot()).toMatchObject({ active: true, completedCount: 1 })
    requests[1]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    expect(requests).toHaveLength(2)
    expect(settled).toHaveBeenCalledOnce()
    expect(controller.snapshot()).toMatchObject({
      active: false,
      phase: 'complete',
      completedCount: 2,
      frameCount: 2,
      integrationSeconds: 20,
      error: null,
    })
    expect(records.map(record => record.outcome)).toEqual(['unsaved', 'unsaved'])
  })

  it('saves the Nth frame before it ends the run', async () => {
    const store = createMemorySavedImageStore()
    const { controller, requests, frame } = setup(store)
    await controller.start(10, { repeat: true, saveFrames: true, frameCount: 2 })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    expect(controller.snapshot()).toMatchObject({ phase: 'complete', savedCount: 2, error: null })
    expect(await store.count('fra 400')).toBe(2)
  })

  it('keeps repeating when no frame count is given, and forgets the last run\'s count', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10, { repeat: true, frameCount: 1 })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    await controller.start(10, { repeat: true })
    expect(controller.snapshot().frameCount).toBeNull()

    for (let index = 1; index <= 3; index++) {
      requests[index]!.resolve(frame)
      await vi.waitFor(() => expect(requests).toHaveLength(index + 2))
    }

    expect(controller.snapshot()).toMatchObject({ active: true, completedCount: 3 })
    const stopping = controller.stop()
    requests.at(-1)!.reject(new CaptureStoppedError())
    await stopping
  })

  it('does not count a lost frame, so the run takes another to reach N', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10, { repeat: true, frameCount: 1 })
    requests[0]!.reject(new CaptureFrameLostError('Cria no longer holds this image; the frame is lost'))
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(controller.snapshot()).toMatchObject({ active: true, completedCount: 0, lostFrameCount: 1 })
    requests[1]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    expect(controller.snapshot()).toMatchObject({ phase: 'complete', completedCount: 1, lostFrameCount: 1, error: null })
  })

  it('does not count a frame whose save failed, and ends the run failed', async () => {
    const store = createMemorySavedImageStore()
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('Disk full'))
    const { controller, requests, frame } = setup(store)
    await controller.start(10, { repeat: true, saveFrames: true, frameCount: 1 })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    expect(requests).toHaveLength(1)
    expect(controller.snapshot()).toMatchObject({ phase: 'failed', savedCount: 0 })
    expect(controller.snapshot().error).toContain('Disk full')
  })

  it('keeps what a manual stop before N already took', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10, { repeat: true, frameCount: 3 })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    const stopping = controller.stop()
    requests[1]!.reject(new CaptureStoppedError())
    expect(await stopping).toMatchObject({ phase: 'stopped', completedCount: 1, frameCount: 3, error: null })
  })
})

it('ends a single exposure whose frame was lost, and says so', async () => {
  const { controller, requests } = setup()
  await controller.start(10, { repeat: false })
  requests[0]!.reject(new CaptureFrameLostError('Cria no longer holds this image; the frame is lost'))
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    completedCount: 0,
    lostFrameCount: 1,
    error: 'Cria no longer holds this image; the frame is lost',
  })
  expect(requests).toHaveLength(1)
})

it.each(['readout', 'preview'] as const)(
  'stops during %s without another exposure and publishes a frame that wins the race',
  async phase => {
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
    expect(controller.snapshot()).toMatchObject({
      phase: 'stopping',
      active: true,
      completedCount: 0,
    })
    expect(settled).not.toHaveBeenCalled()
    requests[0]!.resolve(frame)
    expect(await stopping).toMatchObject({
      phase: 'complete',
      active: false,
      completedCount: 1,
      latestImage: { capturedAt: frame.capturedAt },
    })
    expect(requests).toHaveLength(1)
    expect(settled).toHaveBeenCalledOnce()
  },
)

it('hands each published frame to its observer, and an observer that throws does not end the run', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const seen: Array<string | null> = []

  try {
    const { controller, requests, frame } = setup()

    await controller.start(10, {
      repeat: true,
      onFrame(image) {
        seen.push(image.id)
        throw new Error('observer failed')
      },
    })

    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(requests).toHaveLength(2))

    expect(seen).toEqual([controller.snapshot().latestImage!.id])
    expect(controller.snapshot()).toMatchObject({ active: true, phase: 'exposing', completedCount: 1, error: null })
    expect(warning).toHaveBeenCalledWith('Capture frame observer failed', expect.any(Error))

    const stopping = controller.stop()
    requests[1]!.reject(new CaptureStoppedError())
    await stopping
  } finally {
    warning.mockRestore()
  }
})

it('retains an acquired image when optional star analysis is unavailable', async () => {
  const measure = vi
    .spyOn(statistics, 'measureStars')
    .mockRejectedValueOnce(new Error('Analysis failed'))

  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

  try {
    const { controller, complete } = setup()
    await complete()
    expect(controller.snapshot()).toMatchObject({
      phase: 'complete',
      completedCount: 1,
      latestImage: { statistics: null },
    })
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
  expect(await savedImages.file('fra 400', selected.id, 'native')).toEqual(
    controller.image(selected.id),
  )
  const fits = (await savedImages.file('fra 400', selected.id, 'fits'))!
  expect(fits.toString('ascii', 0, 2880)).toContain('BITPIX  =                   16')
  expect(fits.readInt16BE(2880 + 2) + 32_768).toBe(frame.pixels[1])
  expect((await controller.keep(selected.id))?.id).toBe(selected.id)
  await complete(30)
  expect(await savedImages.count('fra 400')).toBe(1)
  expect(controller.snapshot()).toMatchObject({
    saveFrames: false,
    savedImageCount: 1,
    latestImage: { saved: false },
  })
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
  expect(await stopping).toMatchObject({
    active: false,
    completedCount: 2,
    savedCount: 2,
    integrationSeconds: 20,
    latestImage: { saved: true },
  })
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
  expect(controller.snapshot()).toMatchObject({
    phase: 'failed',
    completedCount: 1,
    savedCount: 0,
    integrationSeconds: 10,
    latestImage: { saved: false },
  })
  expect(controller.snapshot().error).toContain('Disk full')
  const id = controller.snapshot().latestImage!.id
  expect(await controller.keep(id)).toMatchObject({ id, saved: true })
  expect(controller.snapshot().latestImage?.saved).toBe(true)
  expect(await store.count('fra 400')).toBe(1)
  expect(controller.snapshot().savedCount).toBe(1)
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
  expect(image).toMatchObject({
    capturedAt: frame.capturedAt,
    capturedAtSource: 'server-estimate',
    saved: true,
  })
  expect(await savedImages.get('fra 400', image.id)).toMatchObject({
    capturedAt: frame.capturedAt,
    capturedAtSource: 'server-estimate',
  })
  const fits = (await savedImages.file('fra 400', image.id, 'fits'))!.toString('ascii', 0, 2880)
  expect(fits).toContain("DATE-OBS= '2026-09-05T16:00:00.000Z'")
  expect(fits).toContain("TIMESRC = 'SERVER-ESTIMATE'")
  expect(fits).toContain('COMMENT DATE-OBS estimated from server UTC before StartExposure.')
})


it('snapshots subject intent and counts only published integration, retaining image intent across a targetless run', async () => {
  const { controller, requests, frame } = setup()
  const subject = { targetId: 'ngc0224', name: 'Andromeda Galaxy', catalog: 'NGC 224' }
  await controller.start(7, { repeat: true, subject })
  subject.name = 'Changed selection'
  expect(controller.snapshot()).toMatchObject({
    subject: { name: 'Andromeda Galaxy' }, completedCount: 0, integrationSeconds: 0,
  })
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(controller.snapshot()).toMatchObject({ completedCount: 1, integrationSeconds: 7 })
  const stopping = controller.stop()
  requests[1]!.reject(new CaptureStoppedError())
  await stopping
  expect(controller.snapshot()).toMatchObject({ completedCount: 1, integrationSeconds: 7 })
  await controller.start(3)
  expect(controller.snapshot()).toMatchObject({
    subject: null, savedCount: 0, integrationSeconds: 0, completedCount: 0,
    latestImage: { subject: { name: 'Andromeda Galaxy' } },
  })
  requests[2]!.resolve(frame)
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  expect(controller.snapshot()).toMatchObject({ integrationSeconds: 3, latestImage: { subject: null } })
})

it('counts overlapping automatic and manual Keep once, and excludes an older run save completing during a new run', async () => {
  const store = createMemorySavedImageStore()
  const gate = deferred<void>()
  const original = store.save.bind(store)

  const save = vi.spyOn(store, 'save').mockImplementation(async (...args) => {
    await gate.promise

    return original(...args)
  })

  const { controller, requests, frame } = setup(store)
  await controller.start(5, { saveFrames: true })
  requests[0]!.resolve(frame)
  await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
  const image = controller.snapshot().latestImage!
  const keeping = controller.keep(image.id)
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  const stopping = controller.stop()
  expect(controller.snapshot()).toMatchObject({ phase: 'stopping', savedCount: 0, integrationSeconds: 5 })
  gate.resolve()
  await Promise.all([keeping, stopping])
  await controller.keep(image.id)
  expect(controller.snapshot()).toMatchObject({ savedCount: 1, savedImageCount: 1, integrationSeconds: 5 })

  save.mockRestore()
  await controller.start(8)
  requests[1]!.resolve(frame)
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  const olderImage = controller.snapshot().latestImage!
  const olderGate = deferred<void>()

  const olderSave = vi.spyOn(store, 'save').mockImplementationOnce(async (...args) => {
    await olderGate.promise

    return original(...args)
  })

  const olderKeep = controller.keep(olderImage.id)
  await vi.waitFor(() => expect(olderSave).toHaveBeenCalledOnce())
  await controller.start(11)
  olderGate.resolve()
  await olderKeep
  expect(controller.snapshot()).toMatchObject({ savedCount: 0, savedImageCount: 2, integrationSeconds: 0 })
  requests[2]!.resolve(frame)
  await vi.waitFor(() => expect(controller.active()).toBe(false))
  await controller.keep(controller.snapshot().latestImage!.id)
  expect(controller.snapshot()).toMatchObject({ savedCount: 1, savedImageCount: 3, integrationSeconds: 11 })
})

describe('capture telemetry', () => {
  const memory = new InMemorySpanExporter()

  beforeEach(() => {
    memory.reset()
    trace.setGlobalTracerProvider(new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] }))
  })

  afterEach(() => trace.disable())

  const spans = (name: string) => memory.getFinishedSpans().filter(span => span.name === name)

  it('records each frame with its timings, size and what became of it, and totals the run', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10, { repeat: true, saveFrames: true })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    const stopping = controller.stop()
    requests[1]!.reject(new CaptureStoppedError())
    await stopping

    expect(spans('capture.run.started')[0]!.attributes).toMatchObject({
      'capture.rig.id': 'fra 400',
      'capture.exposure.seconds': 10,
      'capture.run.repeat': true,
      'capture.run.saveFrames': true,
    })

    const [saved, stopped] = spans('capture.frame')
    expect(saved!.attributes).toMatchObject({ 'capture.frame.index': 1, 'capture.frame.outcome': 'saved' })

    for (const key of ['capture.acquire.ms', 'capture.overhead.ms', 'capture.process.ms', 'capture.save.ms', 'capture.fits.bytes'])
      expect(saved!.attributes[key]).toEqual(expect.any(Number))

    expect(saved!.attributes['capture.fits.bytes']).toBeGreaterThan(0)
    expect(saved!.status.code).toBe(0)
    expect(stopped!.attributes).toMatchObject({ 'capture.frame.index': 2, 'capture.frame.outcome': 'stopped' })
    expect(spans('capture.frame')).toHaveLength(2)

    expect(spans('capture.run.ended')[0]!.attributes).toMatchObject({
      'capture.run.phase': 'stopped',
      'capture.run.completed': 1,
      'capture.run.lost': 0,
      'capture.run.saved': 1,
    })
  })

  it('records the exposure the camera took for a bias frame, not the one requested', async () => {
    const { controller, requests, frame } = setup(undefined, undefined, undefined, async () => 0.000032)
    await controller.start(0.1, { frameType: 'bias' })
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    expect(spans('capture.frame')[0]!.attributes).toMatchObject({
      'capture.frame.type': 'bias',
      'capture.exposure.seconds': 0.000032,
    })
  })

  it('marks a lost frame as an error and a frame that is not saved as unsaved', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10, { repeat: true })
    requests[0]!.reject(new CaptureFrameLostError('Cria no longer holds this image; the frame is lost'))
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1]!.resolve(frame)
    await vi.waitFor(() => expect(requests).toHaveLength(3))
    const stopping = controller.stop()
    requests[2]!.reject(new CaptureStoppedError())
    await stopping

    const [lost, unsaved] = spans('capture.frame')
    expect(lost!.attributes['capture.frame.outcome']).toBe('lost')
    expect(lost!.status).toMatchObject({ code: 2, message: 'Cria no longer holds this image; the frame is lost' })
    expect(unsaved!.attributes).toMatchObject({ 'capture.frame.index': 2, 'capture.frame.outcome': 'unsaved' })
    expect(unsaved!.attributes['capture.save.ms']).toBeUndefined()
    expect(spans('capture.run.ended')[0]!.attributes).toMatchObject({ 'capture.run.completed': 1, 'capture.run.lost': 1 })
  })

  it('puts the ids the camera reported on the frame span, the image and the frame record', async () => {
    const records: FrameRecord[] = []
    const { controller, requests, frame } = setup(undefined, { append: record => records.push(record), close: async () => {} })
    await controller.start(10)
    requests[0]!.onProvenance({ requestId: 'request-1', operationId: null, imageId: null })
    requests[0]!.onProvenance({ requestId: 'request-1', operationId: 'operation-1', imageId: 'image-1' })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    expect(spans('capture.frame')[0]!.attributes).toMatchObject({
      'capture.provenance.request.id': 'request-1',
      'capture.provenance.operation.id': 'operation-1',
      'capture.provenance.image.id': 'image-1',
      'capture.image.id': controller.snapshot().latestImage!.id,
    })
    expect(controller.snapshot().latestImage!.provenance).toEqual({
      requestId: 'request-1',
      operationId: 'operation-1',
      imageId: 'image-1',
    })
    expect(records).toHaveLength(1)
    expect(records[0]!.provenance).toEqual(controller.snapshot().latestImage!.provenance)
  })

  it('records a camera that reports no ids as carrying none', async () => {
    const records: FrameRecord[] = []
    const { controller, requests, frame } = setup(undefined, { append: record => records.push(record), close: async () => {} })
    await controller.start(10)
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    expect(controller.snapshot().latestImage!.provenance).toBeNull()
    expect(records[0]!.provenance).toBeNull()
    expect(spans('capture.frame')[0]!.attributes['capture.provenance.request.id']).toBeUndefined()
  })

  it('records an exposure the adapter could not account for as uncertain', async () => {
    const records: FrameRecord[] = []
    const { controller, requests } = setup(undefined, { append: record => records.push(record), close: async () => {} })
    await controller.start(10, { repeat: true })
    requests[0]!.reject(new CaptureUncertainError('Cria restarted while capture was running'))
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ outcome: 'uncertain', message: 'Cria restarted while capture was running' })
    expect(controller.snapshot()).toMatchObject({ phase: 'failed' })
  })

  it('records when the camera reads retry during a frame and how long', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10)
    requests[0]!.onReadState('retrying')
    requests[0]!.onReadState('retrying')
    requests[0]!.onReadState('current')
    requests[0]!.onReadState('retrying')
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    const [span] = spans('capture.frame')
    expect(span!.events.map(event => event.name)).toEqual([
      'capture.read.retrying',
      'capture.read.recovered',
      'capture.read.retrying',
      'capture.read.recovered',
    ])
    expect(span!.attributes['capture.read.retrying.count']).toBe(2)
    expect(span!.attributes['capture.read.retrying.ms']).toEqual(expect.any(Number))
  })

  it('counts no retrying reads for a frame that never retried', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10)
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    expect(spans('capture.frame')[0]!.attributes).toMatchObject({
      'capture.read.retrying.count': 0,
      'capture.read.retrying.ms': 0,
    })
  })

  it('records a save failure on the frame and the error on the run', async () => {
    const store = createMemorySavedImageStore()
    vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('disk full'))
    const { controller, requests, frame } = setup(store)
    await controller.start(10, { repeat: true, saveFrames: true })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))

    const [failed] = spans('capture.frame')
    expect(failed!.attributes['capture.frame.outcome']).toBe('save-failed')
    expect(failed!.attributes['capture.save.ms']).toEqual(expect.any(Number))
    expect(failed!.status.code).toBe(2)
    expect(spans('capture.run.ended')[0]!.attributes).toMatchObject({ 'capture.run.phase': 'failed' })
    expect(spans('capture.run.ended')[0]!.attributes['capture.run.error']).toContain('disk full')
  })
})

describe('frame types', () => {
  it('takes lights unless asked otherwise, and writes that into the FITS', async () => {
    const { controller, requests, frame, savedImages } = setup()
    expect(controller.snapshot().frameType).toBe('light')
    expect(await controller.start(10, { saveFrames: true })).toMatchObject({ frameType: 'light' })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    const image = controller.snapshot().latestImage!
    expect(image.frameType).toBe('light')
    const fits = (await savedImages.file('fra 400', image.id, 'fits'))!.toString('ascii', 0, 2880)
    expect(fits).toContain("IMAGETYP= 'LIGHT'")
  })

  it.each([
    ['dark', 'DARK'],
    ['flat', 'FLAT'],
    ['dark-flat', 'DARKFLAT'],
    ['bias', 'BIAS'],
  ] as const)('carries %s into the run, the frame, the saved record, the FITS and the frame record', async (frameType, keyword) => {
    const records: FrameRecord[] = []
    const { controller, requests, frame, savedImages } = setup(undefined, { append: record => void records.push(record), close: async () => {} })
    expect(await controller.start(10, { saveFrames: true, frameType })).toMatchObject({ frameType, subject: null })
    expect(requests[0]).toMatchObject({ frameType })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    const view = controller.snapshot()
    expect(view).toMatchObject({ frameType, latestImage: { frameType, subject: null, saved: true } })
    expect(await savedImages.get('fra 400', view.latestImage!.id)).toMatchObject({ frameType })
    const fits = (await savedImages.file('fra 400', view.latestImage!.id, 'fits'))!.toString('ascii', 0, 2880)
    expect(fits).toContain(`IMAGETYP= '${keyword}'`)
    expect(records).toMatchObject([{ frameType, outcome: 'saved' }])
  })

  describe('the exposure a frame records', () => {
    const exptime = (fits: Buffer) => Number(/EXPTIME =\s+(\S+)/.exec(fits.toString('ascii', 0, 2880))![1])

    function withMinimum(biasExposureSeconds?: CaptureCamera['biasExposureSeconds']) {
      const records: FrameRecord[] = []
      const frameRecords = { append: (record: FrameRecord) => void records.push(record), close: async () => {} }

      return { ...setup(undefined, frameRecords, undefined, biasExposureSeconds), records }
    }

    async function settle(test: ReturnType<typeof withMinimum>, seconds: number, frameType: FrameType) {
      await test.controller.start(seconds, { saveFrames: true, frameType })
      await vi.waitFor(() => expect(test.requests).toHaveLength(1))
      test.requests[0]!.resolve(test.frame)
      await vi.waitFor(() => expect(test.controller.active()).toBe(false))
      const image = test.controller.snapshot().latestImage!

      return { image, fits: (await test.savedImages.file('fra 400', image.id, 'fits'))! }
    }

    it('is the camera minimum for a bias, in the FITS, the image, the frame record and the integration', async () => {
      const test = withMinimum(async () => 0.000032)
      const { image, fits } = await settle(test, 0.1, 'bias')

      expect(test.requests[0]).toMatchObject({ exposureSeconds: 0.1, frameType: 'bias' })
      expect(exptime(fits)).toBe(0.000032)
      expect(image.exposureSeconds).toBe(0.000032)
      expect(test.controller.snapshot()).toMatchObject({ integrationSeconds: 0.000032, exposureSeconds: 0.1, elapsedSeconds: 0.1 })
      expect(await test.savedImages.get('fra 400', image.id)).toMatchObject({ exposureSeconds: 0.000032 })
      expect(test.records).toMatchObject([{ frameType: 'bias', exposureSeconds: 0.000032, outcome: 'saved' }])
    })

    it('is read again for every bias frame', async () => {
      const minimums = [0.000032, 0.0001]
      const test = withMinimum(async () => minimums.shift()!)
      await test.controller.start(0.1, { repeat: true, frameCount: 2, frameType: 'bias' })
      await vi.waitFor(() => expect(test.requests).toHaveLength(1))
      test.requests[0]!.resolve(test.frame)
      await vi.waitFor(() => expect(test.requests).toHaveLength(2))
      test.requests[1]!.resolve(test.frame)
      await vi.waitFor(() => expect(test.controller.active()).toBe(false))

      expect(test.controller.snapshot().integrationSeconds).toBeCloseTo(0.000132, 9)
      expect(test.records.map(record => record.exposureSeconds)).toEqual([0.000032, 0.0001])
    })

    it.each(['light', 'dark', 'flat', 'dark-flat'] as const)('stays the requested time for %s, even when the camera could say a minimum', async frameType => {
      const minimum = vi.fn(async () => 0.000032)
      const test = withMinimum(minimum)
      const { image, fits } = await settle(test, 10, frameType)

      expect(minimum).not.toHaveBeenCalled()
      expect(exptime(fits)).toBe(10)
      expect(image.exposureSeconds).toBe(10)
      expect(test.controller.snapshot().integrationSeconds).toBe(10)
      expect(test.records).toMatchObject([{ frameType, exposureSeconds: 10 }])
    })

    it('stays the requested time for a bias on a camera that is not told the frame type', async () => {
      const test = withMinimum()
      const { image, fits } = await settle(test, 0.1, 'bias')

      expect(exptime(fits)).toBe(0.1)
      expect(image.exposureSeconds).toBe(0.1)
      expect(test.records).toMatchObject([{ frameType: 'bias', exposureSeconds: 0.1 }])
    })

    it.each([
      ['cannot be read', () => Promise.reject(new Error('Cria has no fresh exposureMinimum')), 'could not be read'],
      ['is zero', async () => 0, 'reported 0 s'],
      ['is not a number', async () => Number.NaN, 'reported NaN s'],
    ])('ends a bias run before any exposure when the minimum %s', async (_name, biasExposureSeconds, message) => {
      const test = withMinimum(biasExposureSeconds)
      await test.controller.start(0.1, { saveFrames: true, frameType: 'bias' })
      await vi.waitFor(() => expect(test.controller.active()).toBe(false))

      expect(test.requests).toHaveLength(0)
      expect(test.records).toEqual([])
      expect(test.controller.snapshot()).toMatchObject({
        phase: 'failed',
        completedCount: 0,
        integrationSeconds: 0,
        latestImage: null,
        error: expect.stringContaining(message),
      })
    })

    it('keeps the saved frames and ends the run when the minimum cannot be read for a later bias frame', async () => {
      const readings = [async () => 0.000032, () => Promise.reject(new Error('Cria has no fresh exposureMinimum'))]
      const test = withMinimum(() => readings.shift()!())
      await test.controller.start(0.1, { repeat: true, frameCount: 3, saveFrames: true, frameType: 'bias' })
      await vi.waitFor(() => expect(test.requests).toHaveLength(1))
      test.requests[0]!.resolve(test.frame)
      await vi.waitFor(() => expect(test.controller.active()).toBe(false))

      expect(test.requests).toHaveLength(1)
      expect(test.records).toMatchObject([{ frameType: 'bias', exposureSeconds: 0.000032, outcome: 'saved' }])
      expect(test.controller.snapshot()).toMatchObject({
        phase: 'failed',
        completedCount: 1,
        integrationSeconds: 0.000032,
        error: expect.stringContaining('could not be read'),
      })
    })

    it('is a stop, not a failure, when Stop arrives while the minimum is being read', async () => {
      const reading = deferred<number>()
      const test = withMinimum(async () => reading.promise)
      await test.controller.start(0.1, { frameType: 'bias' })
      const stopping = test.controller.stop()
      reading.reject(new Error('aborted'))
      await stopping

      expect(test.requests).toHaveLength(0)
      expect(test.controller.snapshot()).toMatchObject({ phase: 'stopped', error: null })
    })
  })

  it('returns to light for the next run and keeps the earlier frame as it was taken', async () => {
    const { controller, requests, frame } = setup()
    await controller.start(10, { frameType: 'dark' })
    requests[0]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    const dark = controller.snapshot().latestImage!
    await controller.start(10)
    expect(controller.snapshot()).toMatchObject({ frameType: 'light', latestImage: dark })
    requests[1]!.resolve(frame)
    await vi.waitFor(() => expect(controller.active()).toBe(false))
    expect(controller.snapshot().latestImage!.frameType).toBe('light')
  })
})

describe('the settings written into the FITS header', () => {
  const subject = { targetId: 'm31', name: 'Andromeda Galaxy', catalog: 'M 31' }

  const headerOf = (fits: Buffer) =>
    Object.fromEntries(
      fits
        .toString('ascii', 0, 2880)
        .match(/.{80}/g)!
        .filter(card => card[8] === '=')
        .map(card => [card.slice(0, 8).trim(), card.slice(10).trim()]),
    )

  async function take(
    frameSettings: CaptureCamera['frameSettings'] | undefined,
    options: CaptureRunOptions = {},
  ) {
    const test = setup(undefined, undefined, undefined, undefined, frameSettings)
    await test.controller.start(10, { saveFrames: true, ...options })
    await vi.waitFor(() => expect(test.requests).toHaveLength(1))
    test.requests[0]!.resolve(test.frame)
    await vi.waitFor(() => expect(test.controller.active()).toBe(false))
    const image = test.controller.snapshot().latestImage!

    return { ...test, image, header: headerOf((await test.savedImages.file('fra 400', image.id, 'fits'))!) }
  }

  it('carries what the camera reported, the rig focal length and the subject on a light frame', async () => {
    const { header, image } = await take(async () => ({ gain: 100, offset: 10, binX: 1, sensorTemperatureC: -10, pierSide: 'east' }), {
      subject,
      focalLengthMm: 400,
    })

    expect(image.saved).toBe(true)

    expect(header).toMatchObject({
      GAIN: '100',
      OFFSET: '10',
      XBINNING: '1',
      'CCD-TEMP': '-10',
      PIERSIDE: "'EAST'",
      FOCALLEN: '400',
      OBJECT: "'Andromeda Galaxy'",
    })
  })

  it.each(['light', 'flat'] as const)('names the filter on a %s frame, and the image carries it', async frameType => {
    const { header, image } = await take(async () => ({ gain: 100 }), { frameType, filter: 'L-Ultimate' })

    expect(header).toMatchObject({ FILTER: "'L-Ultimate'" })
    expect(image.filter).toBe('L-Ultimate')
  })

  it.each([
    ['None', null, null],
    ['not said', undefined, undefined],
  ])('writes no FILTER key when the filter is %s, and keeps unknown apart from none', async (_name, filter, recorded) => {
    const { header, image } = await take(async () => ({ gain: 100 }), { filter })

    expect(header).not.toHaveProperty('FILTER')
    expect(image.filter).toBe(recorded)
  })

  it.each(['dark', 'dark-flat', 'bias'] as const)('writes no FILTER key on a %s frame', async frameType => {
    const { header } = await take(async () => ({ gain: 100 }), { frameType, filter: 'L-Ultimate' })

    expect(header).not.toHaveProperty('FILTER')
  })

  it('keeps the filter when the camera cannot be read', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { header } = await take(() => Promise.reject(new Error('no fresh gain')), { filter: 'L-Ultimate' })

    expect(header).toMatchObject({ FILTER: "'L-Ultimate'" })
    expect(header).not.toHaveProperty('GAIN')
    warning.mockRestore()
  })

  it('reads the settings for each frame, not once for the run', async () => {
    const gains = [100, 250]
    const test = setup(undefined, undefined, undefined, undefined, async () => ({ gain: gains.shift()! }))
    await test.controller.start(10, { repeat: true, frameCount: 2, saveFrames: true })
    await vi.waitFor(() => expect(test.requests).toHaveLength(1))
    test.requests[0]!.resolve(test.frame)
    await vi.waitFor(() => expect(test.requests).toHaveLength(2))
    test.requests[1]!.resolve(test.frame)
    await vi.waitFor(() => expect(test.controller.active()).toBe(false))

    const saved = await test.savedImages.list('fra 400')

    const gain = await Promise.all(
      saved.map(async image => headerOf((await test.savedImages.file('fra 400', image.id, 'fits'))!).GAIN),
    )

    expect(gain.sort()).toEqual(['100', '250'])
  })

  it('names no subject on a calibration frame', async () => {
    const { header } = await take(async () => ({ gain: 100 }), { frameType: 'dark' })

    expect(header).toMatchObject({ IMAGETYP: "'DARK'", GAIN: '100' })
    expect(header).not.toHaveProperty('OBJECT')
  })

  it('saves the frame with the settings left out when the camera cannot be read', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const records: FrameRecord[] = []
    const frameRecords = { append: (record: FrameRecord) => void records.push(record), close: async () => {} }
    const test = setup(undefined, frameRecords, undefined, undefined, () => Promise.reject(new Error('Cria has no fresh gain')))
    await test.controller.start(10, { saveFrames: true, subject, focalLengthMm: 400 })
    await vi.waitFor(() => expect(test.requests).toHaveLength(1))
    test.requests[0]!.resolve(test.frame)
    await vi.waitFor(() => expect(test.controller.active()).toBe(false))
    const image = test.controller.snapshot().latestImage!
    const header = headerOf((await test.savedImages.file('fra 400', image.id, 'fits'))!)

    expect(test.controller.snapshot()).toMatchObject({ phase: 'complete', error: null, completedCount: 1, savedCount: 1 })
    expect(records).toMatchObject([{ outcome: 'saved' }])
    expect(header).toMatchObject({ FOCALLEN: '400', OBJECT: "'Andromeda Galaxy'" })
    expect(header).not.toHaveProperty('GAIN')
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Frame settings unavailable'), expect.any(Error))
    warning.mockRestore()
  })

  it('saves the frame without waiting past the limit for a read that hangs', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    try {
      const test = setup(undefined, undefined, undefined, undefined, signal =>
        new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('read timed out')))),
      )

      await test.controller.start(10, { saveFrames: true })
      await vi.waitFor(() => expect(test.requests).toHaveLength(1))
      test.requests[0]!.resolve(test.frame)
      await vi.advanceTimersByTimeAsync(1999)
      expect(test.controller.snapshot().completedCount).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() => expect(test.controller.active()).toBe(false))

      expect(test.controller.snapshot()).toMatchObject({ phase: 'complete', savedCount: 1, error: null })
    } finally {
      vi.useRealTimers()
      warning.mockRestore()
    }
  })

  it('writes the rig focal length and subject for a camera that cannot read settings', async () => {
    const { header } = await take(undefined, { subject, focalLengthMm: 400 })

    expect(header).toMatchObject({ FOCALLEN: '400', OBJECT: "'Andromeda Galaxy'" })
    expect(header).not.toHaveProperty('GAIN')
  })
})

describe('a server restart', () => {
  async function takeFrames(controller: ReturnType<typeof setup>, count: number) {
    for (let taken = 0; taken < count; taken++) {
      const index = controller.requests.length - 1
      controller.requests[index]!.resolve(controller.frame)
      await vi.waitFor(() => expect(controller.controller.snapshot().completedCount).toBe(taken + 1))
      await vi.waitFor(() => expect(controller.requests).toHaveLength(index + 2))
    }
  }

  const subject = { targetId: 'm31', name: 'Andromeda Galaxy', catalog: 'M 31' }

  it('reports the run that was active as interrupted, with how far it got, and exposes nothing', async () => {
    const runs = createMemoryCaptureRunStore()
    const before = setup(undefined, undefined, runs)

    await before.controller.start(30, { repeat: true, frameCount: 5, saveFrames: true, subject })
    await takeFrames(before, 2)

    const after = setup(undefined, undefined, runs)

    expect(after.controller.snapshot()).toMatchObject({
      phase: 'interrupted',
      active: false,
      error: null,
      repeat: true,
      frameCount: 5,
      saveFrames: true,
      frameType: 'light',
      exposureSeconds: 30,
      completedCount: 2,
      savedCount: 2,
      integrationSeconds: 60,
      subject,
      latestImage: null,
      interruption: { reason: 'Vela restarted', remainingCount: 3 },
    })

    expect(after.controller.active()).toBe(false)
    expect(after.requests).toEqual([])
  })

  it('keeps a run that a server shutdown stopped, but not one that Chris stopped', async () => {
    const runs = createMemoryCaptureRunStore()
    const shutdown = setup(undefined, undefined, runs)

    await shutdown.controller.start(30, { repeat: true })
    shutdown.requests[0]!.reject(new CaptureStoppedError())
    await shutdown.controller.close()
    expect(setup(undefined, undefined, runs).controller.snapshot().phase).toBe('interrupted')

    const stoppedRuns = createMemoryCaptureRunStore()
    const stopped = setup(undefined, undefined, stoppedRuns)

    await stopped.controller.start(30, { repeat: true })
    stopped.requests[0]!.reject(new CaptureStoppedError())
    await stopped.controller.stop()
    expect(stopped.controller.snapshot().phase).toBe('stopped')
    expect(setup(undefined, undefined, stoppedRuns).controller.snapshot().phase).toBe('idle')
  })

  it.each([
    ['finishes', (run: ReturnType<typeof setup>) => run.requests[0]!.resolve(run.frame), {}],
    ['fails', (run: ReturnType<typeof setup>) => run.requests[0]!.reject(new Error('camera lost')), { repeat: true }],
  ])('does not report a run that %s before the restart', async (_, end, options) => {
    const runs = createMemoryCaptureRunStore()
    const before = setup(undefined, undefined, runs)

    await before.controller.start(10, options)
    end(before)
    await vi.waitFor(() => expect(before.controller.active()).toBe(false))

    expect(setup(undefined, undefined, runs).controller.snapshot().phase).toBe('idle')
  })

  it('starts a new run over the interrupted one, which is then no longer reported', async () => {
    const runs = createMemoryCaptureRunStore()
    const before = setup(undefined, undefined, runs)

    await before.controller.start(30, { repeat: true, frameCount: 5, frameType: 'dark' })

    const after = setup(undefined, undefined, runs)

    expect(after.controller.interrupted()).toMatchObject({ frameType: 'dark', completedCount: 0 })

    await after.controller.start(10)

    expect(after.controller.interrupted()).toBeUndefined()
    expect(after.controller.snapshot()).toMatchObject({ phase: 'exposing', interruption: null, frameType: 'light' })
    expect(runs.unfinished('fra 400')).toMatchObject({ exposureSeconds: 10, frameType: 'light' })
  })

  it('carries a calibration frame type and an uncounted run through the restart', async () => {
    const runs = createMemoryCaptureRunStore()

    await setup(undefined, undefined, runs).controller.start(5, { repeat: true, frameType: 'bias' })

    expect(setup(undefined, undefined, runs).controller.snapshot()).toMatchObject({
      phase: 'interrupted',
      frameType: 'bias',
      subject: null,
      frameCount: null,
      interruption: { remainingCount: null },
    })
  })
})
