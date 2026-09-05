import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { CaptureStoppedError, type CaptureCamera, type CaptureFrame } from './controller.js'
import { registerCapture, type CaptureSettings } from './routes.js'

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

function setup(selection: { uniqueId: string, name: string } | null = record.imagingCamera, legacySettings?: CaptureSettings) {
  const app = Fastify()
  const { imagingCamera: _, ...unselected } = record
  const catalog = createMemoryRigCatalog([{ ...unselected, ...(selection ? { imagingCamera: selection } : {}) }])
  const operations = createRigOperations()
  let cameraId = 'camera'
  let cameraName = 'Main camera'
  const bindings: Array<{ endpoint: string, cameraId: string, expectedCameraName: string }> = []
  let connected = true
  let activity: 'idle' | 'exposing' = 'idle'
  let inspectionGate: Promise<void> | undefined
  let inspections = 0
  const captures: Array<Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>> = []
  registerCapture(app, catalog, operations, legacySettings, {
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
  cleanups.push(async () => {
    for (const capture of captures) capture.reject(new CaptureStoppedError())
    await app.close()
  })
  const start = (body: unknown = { exposureSeconds: 10 }) => app.inject({ method: 'POST', url: '/api/rigs/sim/capture/start', payload: body as object })
  const get = () => app.inject({ method: 'GET', url: '/api/web/rigs/sim/capture' })
  return { app, catalog, operations, captures, start, get, bindings,
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
  for (const body of [{}, { exposureSeconds: '10' }, { exposureSeconds: 0.09 }, { exposureSeconds: 601 }, { exposureSeconds: 1, gain: 0 }, []]) {
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

it('preserves explicitly configured legacy Capture until a persisted selection exists', async () => {
  const legacy = { endpoint: 'http://127.0.0.1:11111', cameraId: 'camera' }
  const subject = setup(null, legacy)
  expect((await subject.get()).json().enabled).toBe(true)
  expect((await subject.start()).statusCode).toBe(200)
  expect(subject.bindings[0]).toEqual({ ...legacy, expectedCameraName: 'Main camera' })
  expect((await subject.catalog.get('sim'))?.imagingCamera).toBeUndefined()
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())

  for (const selection of [{ uniqueId: 'missing', name: 'Main camera' }, { uniqueId: 'camera', name: 'Changed camera' }]) {
    await subject.catalog.setImagingCamera('sim', selection)
    expect((await subject.start()).statusCode).toBe(409)
  }
  expect(subject.captures).toHaveLength(1)
  await subject.catalog.setImagingCamera('sim', { uniqueId: 'other', name: 'Other camera' })
  subject.replaceCamera('other', 'Other camera')
  expect((await subject.start()).statusCode).toBe(200)
  expect(subject.bindings.at(-1)?.cameraId).toBe('other')

  const otherRig = setup(null, { ...legacy, endpoint: 'http://other:11111' })
  expect((await otherRig.start()).statusCode).toBe(409)
  expect(otherRig.captures).toHaveLength(0)
})
