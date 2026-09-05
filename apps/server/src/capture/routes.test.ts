import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { CaptureStoppedError, type CaptureCamera, type CaptureFrame } from './controller.js'
import { registerCapture, type CaptureSettings } from './routes.js'

const record = {
  id: 'sim', name: 'Simulator', endpoint: { host: '127.0.0.1', port: 11111 },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T20:00:00.000Z',
    devices: [{ uniqueId: 'camera', kind: 'camera' as const, name: 'Simulator camera' }],
  },
}
const settings: CaptureSettings = { endpoint: 'http://127.0.0.1:11111', cameraId: 'camera' }
const frame: CaptureFrame = { width: 2, height: 2, pixels: [0, 100, 400, 1000], capturedAt: '2026-09-05T16:00:00Z' }
const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(configuration: CaptureSettings | undefined = settings) {
  const app = Fastify()
  const catalog = createMemoryRigCatalog([record])
  const operations = createRigOperations()
  let connected = true
  let activity: 'idle' | 'exposing' = 'idle'
  let inspectionGate: Promise<void> | undefined
  let inspections = 0
  const captures: Array<Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>> = []
  registerCapture(app, catalog, operations, configuration, {
    createInspector: () => ({ async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
      inspections++
      await inspectionGate
      return [{ providerDeviceId: 'camera', kind: 'camera', configuredName: 'Simulator camera', name: 'Main camera',
        connection: connected ? 'connected' : 'disconnected',
        telemetry: { availability: 'complete', values: { kind: 'camera', activity } },
      }]
    } }),
    createCamera: () => ({ capture(input) {
      const result = deferred<CaptureFrame>()
      captures.push({ ...input, ...result })
      return result.promise
    } }),
  })
  cleanups.push(async () => {
    for (const capture of captures) capture.reject(new CaptureStoppedError())
    await app.close()
  })
  const start = (body: unknown = { exposureSeconds: 10 }) => app.inject({ method: 'POST', url: '/api/rigs/sim/capture/start', payload: body as object })
  const get = () => app.inject({ method: 'GET', url: '/api/web/rigs/sim/capture' })
  return { app, catalog, operations, captures, start, get,
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

it('never writes to an unconfigured endpoint or camera and releases rejected starts', async () => {
  for (const configuration of [{ endpoint: 'http://other:11111', cameraId: 'camera' }, { ...settings, cameraId: 'different' }]) {
    const subject = setup(configuration)
    expect((await subject.get()).json().enabled).toBe(false)
    expect((await subject.start()).statusCode).toBe(409)
    expect(subject.captures).toHaveLength(0)
    expect(subject.operations.owner('sim')).toBeUndefined()
  }
  const app = Fastify()
  registerCapture(app, createMemoryRigCatalog([record]), createRigOperations())
  cleanups.push(() => app.close())
  expect((await app.inject('/api/web/rigs/sim/capture')).json().enabled).toBe(false)
  expect((await app.inject({ method: 'POST', url: '/api/rigs/sim/capture/start', payload: { exposureSeconds: 10 } })).statusCode).toBe(409)
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
