import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { CaptureStoppedError, type CaptureCamera, type CaptureFrame } from './controller.js'
import { registerCapture } from './routes.js'
import { registerNavigation } from '../navigation.js'
import { createMemorySavedImageStore } from '../saved-images/store.js'
import { registerSavedImages } from '../saved-images/routes.js'

const record = {
  id: 'sim', name: 'Simulator', endpoint: { host: '127.0.0.1', port: 11111 },
  imagingCamera: { uniqueId: 'camera', name: 'Main camera' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T20:00:00.000Z',
    devices: [{ uniqueId: 'camera', kind: 'camera' as const, name: 'Simulator camera' }],
  },
}
const frame: CaptureFrame = { width: 2, height: 2, pixels: [0, 100, 400, 1000], capturedAt: '2026-09-05T16:00:00Z' }
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(selection: { uniqueId: string, name: string } | null = record.imagingCamera) {
  const app = Fastify()
  const { imagingCamera: _, ...unselected } = record
  const catalog = createMemoryRigCatalog([{ ...unselected, ...(selection ? { imagingCamera: selection } : {}) }])
  const operations = createRigOperations()
  const savedImages = createMemorySavedImageStore()
  let cameraId = 'camera'
  let cameraName = 'Main camera'
  const bindings: Array<{ endpoint: string, cameraId: string, expectedCameraName: string }> = []
  let connected = true
  let activity: 'idle' | 'exposing' = 'idle'
  let inspectionGate: Promise<void> | undefined
  let inspections = 0
  const captures: Array<Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>> = []
  const capture = registerCapture(app, catalog, operations, {
    savedImages,
    createInspector: () => ({ async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
      inspections++
      await inspectionGate
      return [{ providerDeviceId: cameraId, kind: 'camera', configuredName: 'Simulator camera', name: cameraName,
        connection: connected ? 'connected' : 'disconnected',
        telemetry: { availability: 'complete', values: { kind: 'camera', activity } },
      }]
    } }),
    createCamera: settings => {
      bindings.push(settings)
      return { capture(input) {
      const result = deferred<CaptureFrame>()
      captures.push({ ...input, ...result })
      return result.promise
    } }
    },
  })
  registerNavigation(app, catalog, capture)
  registerSavedImages(app, catalog, savedImages)
  cleanups.push(async () => {
    for (const capture of captures) capture.reject(new CaptureStoppedError())
    await app.close()
  })
  const start = (body: unknown = { exposureSeconds: 10 }) => app.inject({ method: 'POST', url: '/api/rigs/sim/capture/start', payload: body as object })
  const get = () => app.inject({ method: 'GET', url: '/api/web/rigs/sim/capture' })
  return { app, catalog, operations, captures, start, get, bindings, savedImages,
    replaceCamera: (id: string, name: string) => {
      cameraId = id
      cameraName = name
    },
    disconnect: () => { connected = false },
    externallyBusy: () => { activity = 'exposing' },
    delayInspection: (gate: Promise<void>) => { inspectionGate = gate },
    inspections: () => inspections,
  }
}

it('rejects malformed input before acquiring or operating a camera', async () => {
  const subject = setup()
  for (const body of [{}, { exposureSeconds: '10' }, { exposureSeconds: 0.09 }, { exposureSeconds: 601 }, { exposureSeconds: 1, gain: 0 }, { exposureSeconds: 1, repeat: 'true' }, { exposureSeconds: 1, repeat: null }, { exposureSeconds: 1, saveFrames: 'true' }, { exposureSeconds: 1, saveFrames: null }, []]) {
    expect((await subject.start(body)).statusCode).toBe(400)
  }
  expect(subject.inspections()).toBe(0)
  expect(subject.captures).toHaveLength(0)
  expect(subject.operations.owner('sim')).toBeUndefined()
})

it('never captures without a matching explicitly selected identity', async () => {
  for (const selection of [null, { uniqueId: 'different', name: 'Main camera' }, { uniqueId: 'camera', name: 'Replaced camera' }]) {
    const subject = setup(selection)
    expect((await subject.get()).json().enabled).toBe(false)
    expect((await subject.start()).statusCode).toBe(409)
    expect(subject.captures).toHaveLength(0)
    expect(subject.operations.owner('sim')).toBeUndefined()
  }
})

it('holds mutual exclusion before readiness awaits and through pending cleanup', async () => {
  const subject = setup()
  const gate = deferred<void>()
  subject.delayInspection(gate.promise)
  const starting = subject.start()
  void starting.then(() => {})
  await vi.waitFor(() => expect(subject.inspections()).toBe(1))
  expect(subject.operations.acquire('sim', 'alignment')).toBeUndefined()
  expect((await subject.start()).statusCode).toBe(409)
  gate.resolve()
  expect((await starting).json()).toMatchObject({ active: true, phase: 'exposing' })
  const stopping = subject.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/stop', payload: {} })
  void stopping.then(() => {})
  await vi.waitFor(() => expect(subject.captures[0]!.signal.aborted).toBe(true))
  expect(subject.operations.acquire('sim', 'connection')).toBeUndefined()
  subject.captures[0]!.reject(new CaptureStoppedError())
  expect((await stopping).json()).toMatchObject({ active: false, phase: 'stopped' })
  expect(subject.operations.owner('sim')).toBeUndefined()
})

it('reports another owner as unavailable without starting a second operation', async () => {
  const subject = setup()
  const release = subject.operations.acquire('sim', 'alignment')!
  expect((await subject.get()).json()).toMatchObject({ enabled: false, unavailableReason: 'Another Rig operation is in progress.' })
  expect((await subject.start()).statusCode).toBe(409)
  expect(subject.captures).toHaveLength(0)
  release()
})

it('retains image metadata across failure and serves it while disconnected, while Stop stays available', async () => {
  const subject = setup()
  expect((await subject.start()).statusCode).toBe(200)
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  const previous = (await subject.get()).json().latestImage
  expect(previous).toMatchObject({ exposureSeconds: 10, capturedAt: frame.capturedAt, width: 2, height: 2 })
  await subject.start({ exposureSeconds: 30 })
  subject.captures[1]!.reject(new Error('Readout failed'))
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json()).toMatchObject({ phase: 'failed', error: 'Readout failed', latestImage: previous })
  await subject.start()
  subject.disconnect()
  expect((await subject.get()).json()).toMatchObject({ enabled: false, active: true, latestImage: previous })
  const image = await subject.app.inject(previous.imageUrl)
  expect(image.statusCode).toBe(200)
  expect(image.headers['content-type']).toBe('image/png')
  const stopping = subject.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/stop', payload: {} })
  void stopping.then(() => {})
  await vi.waitFor(() => expect(subject.captures[2]!.signal.aborted).toBe(true))
  subject.captures[2]!.reject(new CaptureStoppedError())
  expect((await stopping).json()).toMatchObject({ phase: 'stopped', latestImage: previous })
  expect((await subject.start()).statusCode).toBe(409)
  expect(subject.captures).toHaveLength(3)
})

it('does not advertise a camera owned outside Vela as ready', async () => {
  const subject = setup()
  subject.externallyBusy()
  expect((await subject.get()).json()).toMatchObject({ enabled: false, unavailableReason: 'The camera has not confirmed it is idle.' })
  expect((await subject.start()).statusCode).toBe(409)
  expect(subject.captures).toHaveLength(0)
})

it('binds each exposure to the current selection and endpoint while retaining earlier image identity', async () => {
  const subject = setup()
  await subject.start()
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  const previous = (await subject.get()).json().latestImage
  subject.replaceCamera('other', 'Other camera')
  await subject.catalog.setImagingCamera('sim', { uniqueId: 'other', name: 'Other camera' })
  await subject.catalog.observe({ host: 'moved.local', port: 22222 }, record.lastObservedInventory)
  expect((await subject.start()).statusCode).toBe(200)
  expect(subject.bindings.at(-1)).toMatchObject({ endpoint: 'http://moved.local:22222', cameraId: 'other', expectedCameraName: 'Other camera' })
  expect((await subject.get()).json()).toMatchObject({ camera: { name: 'Other camera' }, latestImage: previous })
  subject.captures[1]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json().latestImage.cameraName).toBe('Other camera')
  expect((await subject.app.inject(previous.imageUrl)).statusCode).toBe(200)
})

it('owns repeated capture across reads and releases the Rig lease only after confirmed Stop', async () => {
  const subject = setup()
  expect((await subject.get()).json()).toMatchObject({ repeat: true, completedCount: 0 })
  expect((await subject.start({ exposureSeconds: 10, repeat: true })).json()).toMatchObject({ repeat: true, active: true })
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.captures).toHaveLength(2))
  const current = (await subject.get()).json()
  expect(current).toMatchObject({ repeat: true, active: true, completedCount: 1, phase: 'exposing' })
  expect(subject.operations.acquire('sim', 'alignment')).toBeUndefined()
  expect((await subject.start()).statusCode).toBe(409)
  const stopping = subject.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/stop', payload: {} })
  void stopping.then(() => {})
  await vi.waitFor(() => expect(subject.captures[1]!.signal.aborted).toBe(true))
  expect(subject.operations.owner('sim')).toBe('capture')
  subject.captures[1]!.reject(new CaptureStoppedError())
  expect((await stopping).json()).toMatchObject({ phase: 'stopped', completedCount: 1, latestImage: current.latestImage })
  expect(subject.operations.owner('sim')).toBeUndefined()
  expect(subject.captures).toHaveLength(2)
})

it('retains a displayed frame and serves original and preview downloads while disconnected', async () => {
  const subject = setup()
  await subject.start()
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  const image = (await subject.get()).json().latestImage
  const originalPreview = (await subject.app.inject(image.imageUrl)).rawPayload
  subject.disconnect()
  const keepUrl = `${image.imageUrl}/keep`
  expect((await subject.app.inject({ method: 'POST', url: keepUrl, payload: { all: true } })).statusCode).toBe(400)
  const kept = await subject.app.inject({ method: 'POST', url: keepUrl, payload: {} })
  expect(kept.statusCode).toBe(200)
  const saved = kept.json()
  expect(saved).toMatchObject({ id: image.id, rigId: 'sim', saved: true, exposureSeconds: 10 })
  expect((await subject.app.inject({ method: 'POST', url: keepUrl, payload: {} })).json()).toEqual(saved)
  expect((await subject.get()).json()).toMatchObject({ savedImageCount: 1, latestImage: { saved: true } })
  const listing = (await subject.app.inject('/api/web/rigs/sim/saved-images')).json()
  expect(listing).toMatchObject({ rigId: 'sim', rigName: 'Simulator', images: [saved] })
  expect((await subject.app.inject(`/api/web/rigs/sim/saved-images/${saved.id}`)).json()).toEqual({ rigId: 'sim', rigName: 'Simulator', image: saved })
  const fits = await subject.app.inject(saved.fitsUrl)
  expect(fits.headers['content-type']).toBe('application/fits')
  expect(fits.headers['content-disposition']).toContain('attachment; filename=')
  expect(fits.rawPayload.readInt32BE(2880 + 12)).toBe(1000)
  expect((await subject.app.inject(saved.previewDownloadUrl)).rawPayload).toEqual(originalPreview)
  expect((await subject.app.inject(saved.imageUrl)).rawPayload).toEqual(originalPreview)
  expect((await subject.app.inject('/api/web/rigs/other/saved-images')).statusCode).toBe(404)
})

it('auto-saves a single exposure and returns honest errors for unavailable storage or expired frames', async () => {
  const subject = setup()
  await subject.start({ exposureSeconds: 10, saveFrames: true })
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json()).toMatchObject({ saveFrames: true, savedImageCount: 1, latestImage: { saved: true } })
  expect((await subject.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/images/expired/keep', payload: {} })).statusCode).toBe(410)
  vi.spyOn(subject.savedImages, 'list').mockRejectedValue(new Error('Storage unreadable'))
  expect((await subject.app.inject('/api/web/rigs/sim/saved-images')).statusCode).toBe(503)
  vi.spyOn(subject.savedImages, 'count').mockRejectedValue(new Error('Storage unreadable'))
  expect((await subject.get()).json()).toMatchObject({ enabled: true, savedImageCount: null })
})


it('projects navigation progress and terminal state without inspecting devices or saved images', async () => {
  const subject = setup()
  const navigation = async () => (await subject.app.inject('/api/web/navigation')).json()
  expect(await navigation()).toEqual({ rigs: [{ id: 'sim', name: 'Simulator' }], captures: [] })
  expect(subject.inspections()).toBe(0)

  await subject.start({ exposureSeconds: 10, repeat: true })
  const inspectionsAtStart = subject.inspections()
  const count = vi.spyOn(subject.savedImages, 'count')
  const list = vi.spyOn(subject.savedImages, 'list')
  subject.captures[0]!.onProgress({ phase: 'exposing', elapsedSeconds: 4 })
  expect((await navigation()).captures).toEqual([{
    rigId: 'sim', rigName: 'Simulator', active: true, phase: 'exposing',
    completedCount: 0, elapsedSeconds: 4, exposureSeconds: 10, error: null,
  }])
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.captures).toHaveLength(2))
  subject.captures[1]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  expect((await navigation()).captures).toEqual([{
    rigId: 'sim', rigName: 'Simulator', active: true, phase: 'reading',
    completedCount: 1, elapsedSeconds: 10, exposureSeconds: 10, error: null,
  }])
  subject.captures[1]!.reject(new Error('Readout failed'))
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await navigation()).captures[0]).toMatchObject({
    rigId: 'sim', rigName: 'Simulator', phase: 'failed', active: false, completedCount: 1, error: 'Readout failed',
  })
  expect(subject.inspections()).toBe(inspectionsAtStart)
  expect(count).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()

  await subject.catalog.forget('sim')
  expect(await navigation()).toEqual({ rigs: [], captures: [] })
})
