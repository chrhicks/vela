import Fastify, { type InjectOptions } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AlpacaCameraCooling,
  AlpacaDeviceInspection,
  AlpacaDeviceTelemetry,
} from '@vela/alpaca'
import type { Acquisition } from '@vela/equipment'
import type { RigFilter } from '@vela/model/web'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { CaptureStoppedError, type CaptureCamera, type CaptureFrame } from './controller.js'
import { configuredCamera, registerCapture, type CaptureSettings } from './routes.js'
import { registerNavigation } from '../navigation.js'
import { createMemorySavedImageStore } from '../saved-images/store.js'
import { createMemoryCaptureRunStore, type CaptureRunStore } from './run-store.js'
import { haltBodyError } from '../http/halt-body.js'
import { emptyHaltRequests, refusedHaltRequests } from '../http/halt-requests.fixture.js'
import { registerSavedImages } from '../saved-images/routes.js'

const record = {
  id: 'sim',
  name: 'Simulator',
  endpoint: { host: '127.0.0.1', port: 11111 },
  imagingCamera: { uniqueId: 'camera', name: 'Main camera' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: {
    observedAt: '2026-09-01T20:00:00.000Z',
    devices: [{ uniqueId: 'camera', kind: 'camera' as const, name: 'Simulator camera' }],
  },
}

const frame: CaptureFrame = {
  width: 2,
  height: 2,
  pixels: [0, 100, 400, 1000],
  capturedAt: '2026-09-05T16:00:00Z',
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

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
  selection: { uniqueId: string; name: string } | null = record.imagingCamera,
  options: {
    lookupSubject?: NonNullable<Parameters<typeof registerCapture>[3]>['lookupSubject']
    cooling?: {
      state: 'on' | 'off'
      setpointControl?: boolean
      powerPercent?: number
      setpointC?: number
    }
    sensorTemperatureC?: number
    createCooling?: (settings: CaptureSettings) => AlpacaCameraCooling
    alerts?: NonNullable<Parameters<typeof registerCapture>[3]>['alerts']
    runs?: CaptureRunStore
    focalLengthMm?: number
    filters?: ReadonlyArray<RigFilter>
  } = {},
) {
  const app = Fastify()
  const { imagingCamera: _, ...unselected } = record

  const configured = {
    ...unselected,
    ...(options.focalLengthMm !== undefined && { focalLengthMm: options.focalLengthMm }),
    ...(options.filters && { filters: options.filters }),
  }

  const catalog = createMemoryRigCatalog([
    selection ? { ...configured, imagingCamera: selection } : configured,
  ])

  const operations = createRigOperations()
  const savedImages = createMemorySavedImageStore()
  let cameraId = 'camera'
  let cameraName = 'Main camera'
  const bindings: CaptureSettings[] = []
  let connected = true
  let activity: 'idle' | 'exposing' = 'idle'
  let inspectionGate: Promise<void> | undefined
  let inspections = 0

  const captures: Array<
    Parameters<CaptureCamera['capture']>[0] & ReturnType<typeof deferred<CaptureFrame>>
  > = []

  const captureOptions: Parameters<typeof registerCapture>[3] = {
    savedImages,
    createAcquisition: () => { throw new Error('Capture tests expose through createCamera') },
    createCooling: options.createCooling ?? (() => { throw new Error('This test configures no cooling') }),
    createInspector: () => ({
      async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
        inspections++
        await inspectionGate

        let values: Extract<AlpacaDeviceTelemetry, { kind: 'camera' }> = {
          kind: 'camera',
          activity,
        }

        if (options.sensorTemperatureC !== undefined) {
          values = { ...values, sensorTemperatureC: options.sensorTemperatureC }
        }

        if (options.cooling) {
          values = { ...values, cooling: options.cooling }
        }

        return [
          {
            providerDeviceId: cameraId,
            kind: 'camera',
            configuredName: 'Simulator camera',
            name: cameraName,
            connection: connected ? 'connected' : 'disconnected',
            telemetry: { availability: 'complete', values },
          },
        ]
      },
    }),
    createCamera: settings => {
      bindings.push(settings)

      return {
        capture(input) {
          const result = deferred<CaptureFrame>()
          captures.push({ ...input, ...result })

          return result.promise
        },
      }
    },
  }

  if (options.lookupSubject) captureOptions.lookupSubject = options.lookupSubject

  if (options.alerts) captureOptions.alerts = options.alerts

  if (options.runs) captureOptions.runs = options.runs

  const capture = registerCapture(app, catalog, operations, captureOptions)

  registerNavigation(app, catalog, capture)
  registerSavedImages(app, catalog, savedImages)
  cleanups.push(async () => {
    for (const capture of captures) capture.reject(new CaptureStoppedError())
    await app.close()
  })

  const start = (body: InjectOptions['payload'] = { exposureSeconds: 10 }) =>
    app.inject({
      method: 'POST',
      url: '/api/rigs/sim/capture/start',
      payload: body,
    })

  const get = () => app.inject({ method: 'GET', url: '/api/web/rigs/sim/capture' })

  return {
    app,
    catalog,
    operations,
    captures,
    start,
    get,
    bindings,
    savedImages,
    replaceCamera: (id: string, name: string) => {
      cameraId = id
      cameraName = name
    },
    disconnect: () => {
      connected = false
    },
    externallyBusy: () => {
      activity = 'exposing'
    },
    delayInspection: (gate: Promise<void>) => {
      inspectionGate = gate
    },
    inspections: () => inspections,
  }
}

it('tells the alert monitor a run is an imaging run only when it repeats and saves its frames', async () => {
  for (const [body, imaging] of [
    [{ exposureSeconds: 10 }, false],
    [{ exposureSeconds: 10, repeat: true }, false],
    [{ exposureSeconds: 10, saveFrames: true }, false],
    [{ exposureSeconds: 10, repeat: true, saveFrames: true }, true],
  ] as const) {
    const runStarted = vi.fn()

    const subject = setup(undefined, {
      alerts: { monitorFor: () => ({ runStarted, frameCaptured: vi.fn(), runEnded: vi.fn(), runInterrupted: vi.fn(), setUnattended: vi.fn() }) },
    })

    expect((await subject.start(body)).statusCode).toBe(200)
    expect(runStarted).toHaveBeenCalledExactlyOnceWith(10, { imaging, calibration: false, unattended: false })
  }
})

it('rejects malformed input before acquiring or operating a camera', async () => {
  const subject = setup()

  for (const body of [
    {},
    { exposureSeconds: '10' },
    { exposureSeconds: 0.09 },
    { exposureSeconds: 601 },
    { exposureSeconds: 1, gain: 0 },
    { exposureSeconds: 1, repeat: 'true' },
    { exposureSeconds: 1, repeat: null },
    { exposureSeconds: 1, saveFrames: 'true' },
    { exposureSeconds: 1, saveFrames: null },
    { exposureSeconds: 1, repeat: true, frameCount: 0 },
    { exposureSeconds: 1, repeat: true, frameCount: -3 },
    { exposureSeconds: 1, repeat: true, frameCount: 2.5 },
    { exposureSeconds: 1, repeat: true, frameCount: '5' },
    { exposureSeconds: 1, repeat: true, frameCount: null },
    { exposureSeconds: 1, repeat: true, frameCount: 10_001 },
    { exposureSeconds: 1, frameCount: 5 },
    { exposureSeconds: 1, repeat: false, frameCount: 5 },
    { exposureSeconds: 1, frameType: 'sky-flat' },
    { exposureSeconds: 1, frameType: 'DARK' },
    { exposureSeconds: 1, frameType: null },
    { exposureSeconds: 1, frameType: 'dark', targetId: 'ngc0224' },
    { exposureSeconds: 1, frameType: 'bias', targetId: 'ngc0224' },
    [],
  ]) {
    expect((await subject.start(body)).statusCode).toBe(400)
  }

  expect((await subject.start({ exposureSeconds: 1, frameCount: 5 })).json().error).toContain(
    'frameCount (a whole number from 1 to 10000, only with repeat: true)',
  )

  expect(subject.inspections()).toBe(0)
  expect(subject.captures).toHaveLength(0)
  expect(subject.operations.owner('sim')).toBeUndefined()
})

it('never captures without a matching explicitly selected identity', async () => {
  for (const selection of [
    null,
    { uniqueId: 'different', name: 'Main camera' },
    { uniqueId: 'camera', name: 'Replaced camera' },
  ]) {
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

  const stopping = subject.app.inject({
    method: 'POST',
    url: '/api/rigs/sim/capture/stop',
  })

  void stopping.then(() => {})
  await vi.waitFor(() => expect(subject.captures[0]!.signal.aborted).toBe(true))
  expect(subject.operations.acquire('sim', 'connection')).toBeUndefined()
  subject.captures[0]!.reject(new CaptureStoppedError())
  expect((await stopping).json()).toMatchObject({ active: false, phase: 'stopped' })
  expect(subject.operations.owner('sim')).toBeUndefined()
})

it.each(emptyHaltRequests)('stops a running capture on %s', async (_name, options) => {
  const subject = setup()
  expect((await subject.start()).statusCode).toBe(200)

  const stopping = subject.app.inject({
    method: 'POST',
    url: '/api/rigs/sim/capture/stop',
    ...options,
  })

  void stopping.then(() => {})
  await vi.waitFor(() => expect(subject.captures[0]!.signal.aborted).toBe(true))
  subject.captures[0]!.reject(new CaptureStoppedError())
  expect((await stopping).json()).toMatchObject({ active: false, phase: 'stopped' })
})

it.each(refusedHaltRequests)('refuses a stop with %s and leaves the run going', async (_name, options) => {
  const subject = setup()
  expect((await subject.start()).statusCode).toBe(200)

  const stopped = await subject.app.inject({
    method: 'POST',
    url: '/api/rigs/sim/capture/stop',
    ...options,
  })

  expect(stopped.statusCode).toBe(400)
  expect(stopped.json()).toEqual({ error: haltBodyError })
  expect(subject.captures[0]!.signal.aborted).toBe(false)
})

it('reports another owner as unavailable without starting a second operation', async () => {
  const subject = setup()
  const release = subject.operations.acquire('sim', 'alignment')!
  expect((await subject.get()).json()).toMatchObject({
    enabled: false,
    unavailableReason: 'Another Rig operation is in progress.',
  })
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
  expect(previous).toMatchObject({
    exposureSeconds: 10,
    capturedAt: frame.capturedAt,
    width: 2,
    height: 2,
  })
  await subject.start({ exposureSeconds: 30 })
  subject.captures[1]!.reject(new Error('Readout failed'))
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json()).toMatchObject({
    phase: 'failed',
    error: 'Readout failed',
    latestImage: previous,
  })
  await subject.start()
  subject.disconnect()
  expect((await subject.get()).json()).toMatchObject({
    enabled: false,
    active: true,
    latestImage: previous,
  })
  const image = await subject.app.inject(previous.imageUrl)
  expect(image.statusCode).toBe(200)
  expect(image.headers['content-type']).toBe('image/png')

  const stopping = subject.app.inject({
    method: 'POST',
    url: '/api/rigs/sim/capture/stop',
  })

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
  expect((await subject.get()).json()).toMatchObject({
    enabled: false,
    unavailableReason: 'The camera has not confirmed it is idle.',
  })
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
  expect(subject.bindings.at(-1)).toMatchObject({
    rig: { endpoint: { host: 'moved.local', port: 22222 } },
    cameraId: 'other',
    expectedCameraName: 'Other camera',
  })
  expect((await subject.get()).json()).toMatchObject({
    camera: { name: 'Other camera' },
    latestImage: previous,
  })
  subject.captures[1]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json().latestImage.cameraName).toBe('Other camera')
  expect((await subject.app.inject(previous.imageUrl)).statusCode).toBe(200)
})

it('owns repeated capture across reads and releases the Rig lease only after confirmed Stop', async () => {
  const subject = setup()
  expect((await subject.get()).json()).toMatchObject({ repeat: true, completedCount: 0 })
  expect((await subject.start({ exposureSeconds: 10, repeat: true })).json()).toMatchObject({
    repeat: true,
    active: true,
  })
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.captures).toHaveLength(2))
  const current = (await subject.get()).json()
  expect(current).toMatchObject({
    repeat: true,
    active: true,
    completedCount: 1,
    phase: 'exposing',
  })
  expect(subject.operations.acquire('sim', 'alignment')).toBeUndefined()
  expect((await subject.start()).statusCode).toBe(409)

  const stopping = subject.app.inject({
    method: 'POST',
    url: '/api/rigs/sim/capture/stop',
  })

  void stopping.then(() => {})
  await vi.waitFor(() => expect(subject.captures[1]!.signal.aborted).toBe(true))
  expect(subject.operations.owner('sim')).toBe('capture')
  subject.captures[1]!.reject(new CaptureStoppedError())
  expect((await stopping).json()).toMatchObject({
    phase: 'stopped',
    completedCount: 1,
    latestImage: current.latestImage,
  })
  expect(subject.operations.owner('sim')).toBeUndefined()
  expect(subject.captures).toHaveLength(2)
})

it('ends a repeating run by itself after frameCount frames and reports the target', async () => {
  const subject = setup()
  expect((await subject.start({ exposureSeconds: 10, repeat: true, frameCount: 2 })).json()).toMatchObject({
    active: true,
    frameCount: 2,
  })
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.captures).toHaveLength(2))
  expect((await subject.get()).json()).toMatchObject({ active: true, completedCount: 1, frameCount: 2 })
  subject.captures[1]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json()).toMatchObject({
    active: false,
    phase: 'complete',
    completedCount: 2,
    frameCount: 2,
    error: null,
  })
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
  expect(
    (await subject.app.inject({ method: 'POST', url: keepUrl, payload: { all: true } })).statusCode,
  ).toBe(400)
  const kept = await subject.app.inject({ method: 'POST', url: keepUrl, payload: {} })
  expect(kept.statusCode).toBe(200)
  const saved = kept.json()
  expect(saved).toMatchObject({ id: image.id, rigId: 'sim', saved: true, exposureSeconds: 10 })
  expect((await subject.app.inject({ method: 'POST', url: keepUrl, payload: {} })).json()).toEqual(
    saved,
  )
  expect((await subject.get()).json()).toMatchObject({
    savedImageCount: 1,
    latestImage: { saved: true },
  })
  const listing = (await subject.app.inject('/api/web/rigs/sim/saved-images')).json()
  expect(listing).toMatchObject({ rigId: 'sim', rigName: 'Simulator', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, images: [saved] })
  expect((await subject.app.inject(`/api/web/rigs/sim/saved-images/${saved.id}`)).json()).toEqual({
    rigId: 'sim',
    rigName: 'Simulator',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    image: saved,
  })
  const fits = await subject.app.inject(saved.fitsUrl)
  expect(fits.headers['content-type']).toBe('application/fits')
  expect(fits.headers['content-disposition']).toContain('attachment; filename=')
  expect(fits.rawPayload.toString('ascii', 0, 2880)).toContain('BITPIX  =                   16')
  expect(fits.rawPayload.readInt16BE(2880 + 6) + 32_768).toBe(1000)
  expect((await subject.app.inject(saved.previewDownloadUrl)).rawPayload).toEqual(originalPreview)
  expect((await subject.app.inject(saved.imageUrl)).rawPayload).toEqual(originalPreview)
  expect((await subject.app.inject('/api/web/rigs/other/saved-images')).statusCode).toBe(404)
})

it('auto-saves a single exposure and returns honest errors for unavailable storage or expired frames', async () => {
  const subject = setup()
  await subject.start({ exposureSeconds: 10, saveFrames: true })
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json()).toMatchObject({
    saveFrames: true,
    savedImageCount: 1,
    latestImage: { saved: true },
  })
  expect(
    (
      await subject.app.inject({
        method: 'POST',
        url: '/api/rigs/sim/capture/images/expired/keep',
        payload: {},
      })
    ).statusCode,
  ).toBe(410)
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
  expect((await navigation()).captures).toEqual([
    {
      rigId: 'sim',
      rigName: 'Simulator',
      active: true,
      phase: 'exposing',
      captureReadState: 'current',
      completedCount: 0,
      elapsedSeconds: 4,
      exposureSeconds: 10,
      error: null,
    },
  ])
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.captures).toHaveLength(2))
  subject.captures[1]!.onProgress({ phase: 'reading', elapsedSeconds: 10 })
  subject.captures[1]!.onReadState('retrying')
  expect((await navigation()).captures).toEqual([
    {
      rigId: 'sim',
      rigName: 'Simulator',
      active: true,
      phase: 'reading',
      captureReadState: 'retrying',
      completedCount: 1,
      elapsedSeconds: 10,
      exposureSeconds: 10,
      error: null,
    },
  ])
  expect(subject.operations.owner('sim')).toBe('capture')
  subject.captures[1]!.onReadState('current')
  expect((await navigation()).captures[0]).toMatchObject({
    active: true,
    phase: 'reading',
    completedCount: 1,
    captureReadState: 'current',
  })
  expect(subject.captures).toHaveLength(2)
  subject.captures[1]!.onReadState('retrying')
  subject.captures[1]!.reject(new Error('Readout failed'))
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await navigation()).captures[0]).toMatchObject({
    rigId: 'sim',
    rigName: 'Simulator',
    phase: 'failed',
    active: false,
    completedCount: 1,
    error: 'Readout failed',
    captureReadState: 'current',
  })
  expect(subject.inspections()).toBe(inspectionsAtStart)
  expect(count).not.toHaveBeenCalled()
  expect(list).not.toHaveBeenCalled()

  await subject.catalog.forget('sim')
  expect(await navigation()).toEqual({ rigs: [], captures: [] })
})

it('shows confirmed cooler-off even when the sensor is near the retained setpoint', async () => {
  const subject = setup(record.imagingCamera, {
    sensorTemperatureC: 4.8,
    cooling: { state: 'off', setpointControl: true, setpointC: 5, powerPercent: 0 },
  })

  expect((await subject.get()).json().cooling).toEqual({
    state: 'off',
    canSetTemperature: true,
    sensorTemperatureC: 4.8,
    setpointC: 5,
    powerPercent: 0,
  })
})

it('turns the cooler on only when requested and does not invent a setpoint write', async () => {
  const commands: Array<{ coolerOn?: boolean; setpointC?: number }> = []

  const subject = setup(record.imagingCamera, {
    sensorTemperatureC: 4.8,
    cooling: { state: 'off', setpointControl: true, setpointC: 5, powerPercent: 0 },
    createCooling: () => ({
      observe: async () => undefined,
      async setCooling(command) {
        if (command.coolerOn !== undefined) commands.push({ coolerOn: command.coolerOn })
        else if (command.setpointC !== undefined) commands.push({ setpointC: command.setpointC })

        return {
          outcome: 'confirmed',
          observation: {
            state: command.coolerOn ? 'on' : 'off',
            canSetTemperature: true,
            canGetPower: true,
            sensorTemperatureC: command.coolerOn ? 5 : 4.8,
            setpointC: command.setpointC ?? 5,
            powerPercent: command.coolerOn ? 18 : 0,
          },
        }
      },
    }),
  })

  expect(
    (
      await subject.app.inject({
        method: 'POST',
        url: '/api/rigs/sim/capture/cooling',
        payload: { setpointC: -5 },
      })
    ).statusCode,
  ).toBe(200)
  expect(
    (
      await subject.app.inject({
        method: 'POST',
        url: '/api/rigs/sim/capture/cooling',
        payload: { coolerOn: true },
      })
    ).statusCode,
  ).toBe(200)
  expect(commands).toEqual([{ setpointC: -5 }, { coolerOn: true }])
  expect(
    (
      await subject.app.inject({
        method: 'POST',
        url: '/api/rigs/sim/capture/cooling',
        payload: {},
      })
    ).statusCode,
  ).toBe(400)
})

it('holds an exclusive cooling lease through confirmation and rejects other cooling or capture commands', async () => {
  const confirmation = deferred<Awaited<ReturnType<AlpacaCameraCooling['setCooling']>>>()
  const commands: Array<Parameters<AlpacaCameraCooling['setCooling']>[0]> = []

  const subject = setup(record.imagingCamera, {
    cooling: { state: 'off' },
    createCooling: () => ({
      observe: async () => undefined,
      setCooling(command) {
        commands.push(command)

        return confirmation.promise
      },
    }),
  })

  const cool = (coolerOn: boolean) =>
    subject.app.inject({
      method: 'POST',
      url: '/api/rigs/sim/capture/cooling',
      payload: { coolerOn },
    })

  const first = cool(true)
  void first.then(() => {})
  await vi.waitFor(() => expect(commands).toHaveLength(1))

  try {
    expect(subject.operations.owner('sim')).toBe('capture')
    let secondSettled = false

    const second = cool(false).then(response => {
      secondSettled = true

      return response
    })

    await vi.waitFor(() => expect(secondSettled).toBe(true))
    expect((await second).statusCode).toBe(409)
    expect((await subject.start()).statusCode).toBe(409)
    expect(subject.operations.acquire('sim', 'alignment')).toBeUndefined()
    expect(commands).toHaveLength(1)
  } finally {
    confirmation.resolve({
      outcome: 'confirmed',
      observation: { state: 'on', canSetTemperature: false, canGetPower: false },
    })
    await first
  }

  expect(subject.operations.owner('sim')).toBeUndefined()
  expect((await subject.start()).statusCode).toBe(200)
  expect((await cool(false)).statusCode).toBe(409)
  expect(commands).toHaveLength(1)
})

it('marks cooling with the operation that would refuse a cooling command', async () => {
  const observed = { state: 'off', canSetTemperature: true, sensorTemperatureC: 18, setpointC: 5 }

  const subject = setup(record.imagingCamera, {
    sensorTemperatureC: 18,
    cooling: { state: 'off', setpointControl: true, setpointC: 5 },
    createCooling: () => {
      throw new Error('A refused cooling command must not reach the camera')
    },
  })

  expect((await subject.get()).json().cooling).toEqual(observed)

  for (const [owner, blockedBy] of [
    ['alignment', 'alignment'],
    ['autofocus', 'autofocus'],
    ['framing', 'framing'],
    ['connection', 'rig'],
    ['capture', 'rig'],
  ] as const) {
    const release = subject.operations.acquire('sim', owner)!

    expect((await subject.get()).json().cooling).toEqual({ ...observed, blockedBy })
    expect(
      (
        await subject.app.inject({
          method: 'POST',
          url: '/api/rigs/sim/capture/cooling',
          payload: { coolerOn: true },
        })
      ).statusCode,
    ).toBe(409)
    release()
  }

  expect((await subject.get()).json().cooling).toEqual(observed)
})

it('marks cooling as held by an active capture run, including in the start response', async () => {
  const subject = setup(record.imagingCamera, { cooling: { state: 'on' } })

  const started = await subject.start()
  expect(started.json().cooling).toEqual({ state: 'on', canSetTemperature: false, blockedBy: 'capture' })
  expect((await subject.get()).json().cooling).toMatchObject({ blockedBy: 'capture' })

  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
  expect((await subject.get()).json().cooling).toEqual({ state: 'on', canSetTemperature: false })
})

it('does not report a confirmed cooling command as blocked by its own lease', async () => {
  const subject = setup(record.imagingCamera, {
    cooling: { state: 'off' },
    createCooling: () => ({
      observe: async () => undefined,
      setCooling: async () => ({
        outcome: 'confirmed',
        observation: { state: 'on', canSetTemperature: false, canGetPower: false },
      }),
    }),
  })

  const response = await subject.app.inject({
    method: 'POST',
    url: '/api/rigs/sim/capture/cooling',
    payload: { coolerOn: true },
  })

  expect(response.statusCode).toBe(200)
  expect(response.json().cooling).not.toHaveProperty('blockedBy')
  expect(subject.operations.owner('sim')).toBeUndefined()
})


it('rejects malformed and unknown subjects before device inspection or acquiring the rig lease', async () => {
  const subject = { targetId: 'ngc0224', name: 'Andromeda Galaxy', catalog: 'NGC 224' }
  const lookupSubject = vi.fn((id: string) => id === subject.targetId ? subject : undefined)
  const { start, operations, captures, inspections, bindings } = setup(record.imagingCamera, { lookupSubject })
  const acquire = vi.spyOn(operations, 'acquire')

  for (const targetId of ['', '   ', 42, null, 'missing']) {
    expect((await start({ exposureSeconds: 10, targetId })).statusCode).toBe(400)
  }

  expect(acquire).not.toHaveBeenCalled()
  expect(inspections()).toBe(0)
  expect(bindings).toEqual([])
  expect(captures).toEqual([])
  const response = await start({ exposureSeconds: 10, targetId: subject.targetId })
  expect(response.statusCode).toBe(200)
  expect(response.json()).toMatchObject({ subject, savedCount: 0, integrationSeconds: 0 })
  expect(captures).toHaveLength(1)
})

it.each(['light', 'dark', 'flat', 'dark-flat', 'bias'] as const)(
  'carries the %s frame type into the run, the frame and its saved record',
  async frameType => {
    const subject = setup()
    const started = await subject.start({ exposureSeconds: 10, saveFrames: true, frameType })
    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ frameType, subject: null })
    expect(subject.captures[0]).toMatchObject({ frameType })
    subject.captures[0]!.resolve(frame)
    await vi.waitFor(() => expect(subject.operations.owner('sim')).toBeUndefined())
    const view = (await subject.get()).json()
    expect(view).toMatchObject({ frameType, latestImage: { frameType, saved: true } })

    const listed = (await subject.app.inject({ method: 'GET', url: '/api/web/rigs/sim/saved-images' })).json()
    expect(listed.images).toMatchObject([{ id: view.latestImage.id, frameType }])
  },
)

it('takes lights unless asked otherwise', async () => {
  const subject = setup()
  expect((await subject.start({ exposureSeconds: 10 })).json()).toMatchObject({ frameType: 'light' })
  expect(subject.captures[0]).toMatchObject({ frameType: 'light' })
})

it.each(['light', 'dark', 'flat', 'dark-flat', 'bias'] as const)('hands the %s frame type to the acquisition', async frameType => {
  const options: Parameters<Acquisition['capture']>[0][] = []

  const acquisition: Pick<Acquisition, 'capture'> = {
    capture: async request => {
      options.push(request)

      return { width: 2, height: 2, pixels: Float64Array.of(0, 100, 400, 1000), capturedAt: frame.capturedAt, color: { kind: 'mono' } }
    },
  }


  await configuredCamera(
    { rig: record, cameraId: 'camera', expectedCameraName: 'Main camera' },
    acquisition,
  ).capture({ exposureSeconds: 10, frameType, signal: new AbortController().signal, onProgress: () => {}, onReadState: () => {}, onProvenance: () => {} })

  expect(options).toMatchObject([{ cameraId: 'camera', expectedCameraName: 'Main camera', exposureSeconds: 10, frameType }])
})

it('reads the bias exposure from the acquisition for the configured camera, and offers none when the acquisition has none', async () => {
  const settings = { rig: record, cameraId: 'camera', expectedCameraName: 'Main camera' }
  const capture: Acquisition['capture'] = async () => expect.unreachable('not exposing')
  const biasExposureSeconds = vi.fn(async () => 0.000032)
  const signal = new AbortController().signal

  expect(await configuredCamera(settings, { capture, biasExposureSeconds }).biasExposureSeconds!(signal)).toBe(0.000032)
  expect(biasExposureSeconds).toHaveBeenCalledExactlyOnceWith('camera', signal)
  expect(configuredCamera(settings, { capture })).not.toHaveProperty('biasExposureSeconds')
})

describe('the settings a configured camera reads for the FITS header', () => {
  const capture: Acquisition['capture'] = async () => expect.unreachable('not exposing')
  const signal = new AbortController().signal
  const camera = { rig: record, cameraId: 'camera', expectedCameraName: 'Main camera' }

  const withTelescopes = (...ids: string[]) => ({
    ...camera,
    rig: {
      ...record,
      lastObservedInventory: {
        ...record.lastObservedInventory,
        devices: [...record.lastObservedInventory.devices, ...ids.map(uniqueId => ({ uniqueId, kind: 'telescope' as const, name: uniqueId }))],
      },
    },
  })

  it('reads the camera and the rig\'s one telescope from the acquisition, and offers none when the acquisition has none', async () => {
    const exposureSettings = vi.fn(async () => ({ gain: 100 }))

    expect(await configuredCamera(withTelescopes('mount'), { capture, exposureSettings }).frameSettings!(signal)).toEqual({ gain: 100 })
    expect(exposureSettings).toHaveBeenCalledExactlyOnceWith({ cameraId: 'camera', telescopeId: 'mount' }, signal)
    expect(configuredCamera(camera, { capture })).not.toHaveProperty('frameSettings')
  })

  it.each([
    ['no telescope', []],
    ['two telescopes', ['mount', 'guide']],
  ])('names no telescope for %s, since its pier side cannot be told', async (_name, telescopes) => {
    const exposureSettings = vi.fn(async () => ({}))
    await configuredCamera(withTelescopes(...telescopes), { capture, exposureSettings }).frameSettings!(signal)

    expect(exposureSettings).toHaveBeenCalledExactlyOnceWith({ cameraId: 'camera' }, signal)
  })
})

it('writes the rig\'s focal length into the saved FITS', async () => {
  const subject = setup(record.imagingCamera, { focalLengthMm: 400 })
  expect((await subject.start({ exposureSeconds: 10, saveFrames: true })).statusCode).toBe(200)
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(async () => expect(await subject.savedImages.list('sim')).toHaveLength(1))

  const [saved] = await subject.savedImages.list('sim')
  const fits = (await subject.savedImages.file('sim', saved!.id, 'fits'))!.toString('ascii', 0, 2880)

  expect(fits).toContain('FOCALLEN=                  400')
})

describe('the filter in front of the camera', () => {
  const filters = [
    { name: 'L-Ultimate', description: 'Optolong L-Ultimate, dual-band H-alpha + OIII, 3 nm' },
    { name: 'UV/IR cut' },
  ]

  async function savedFits(subject: ReturnType<typeof setup>) {
    subject.captures[0]!.resolve(frame)
    await vi.waitFor(async () => expect(await subject.savedImages.list('sim')).toHaveLength(1))

    const [saved] = await subject.savedImages.list('sim')
    const fits = (await subject.savedImages.file('sim', saved!.id, 'fits'))!.toString('ascii', 0, 2880)

    return { saved: saved!, fits }
  }

  it('offers the rig\'s filters in its capture view, and none for a rig without a list', async () => {
    expect((await setup(record.imagingCamera, { filters }).get()).json().filters).toEqual(filters)
    expect((await setup().get()).json().filters).toEqual([])
  })

  it.each(['light', 'flat'] as const)('writes the chosen filter on a %s run into the FITS, the saved image, the run record and the view', async frameType => {
    const runs = createMemoryCaptureRunStore()
    const subject = setup(record.imagingCamera, { filters, runs })
    const started = await subject.start({ exposureSeconds: 10, saveFrames: true, frameType, filter: 'L-Ultimate' })

    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ filter: 'L-Ultimate', filters })
    expect(runs.unfinished('sim')).toMatchObject({ filter: 'L-Ultimate' })

    const { saved, fits } = await savedFits(subject)

    expect(fits).toContain("FILTER  = 'L-Ultimate'")
    expect(saved).toMatchObject({ filter: 'L-Ultimate' })
    expect((await subject.get()).json()).toMatchObject({ filter: 'L-Ultimate', latestImage: { filter: 'L-Ultimate' } })
  })

  it.each([
    ['omitted', {}],
    ['null', { filter: null }],
  ])('records no filter, and never the word None, when it is %s', async (_name, choice) => {
    const runs = createMemoryCaptureRunStore()
    const subject = setup(record.imagingCamera, { filters, runs })

    expect((await subject.start({ exposureSeconds: 10, saveFrames: true, ...choice })).json()).toMatchObject({ filter: null })
    expect(runs.unfinished('sim')).toMatchObject({ filter: null })

    const { saved, fits } = await savedFits(subject)

    expect(fits).not.toContain('FILTER')
    expect(fits).not.toMatch(/none/i)
    expect(saved).toMatchObject({ filter: null })
  })

  it('refuses a filter the rig does not list, and starts nothing', async () => {
    const subject = setup(record.imagingCamera, { filters })

    for (const filter of ['Ha 7nm', 'l-ultimate', '', 'None'])
      expect((await subject.start({ exposureSeconds: 10, filter })).statusCode).toBe(400)

    expect((await setup().start({ exposureSeconds: 10, filter: 'L-Ultimate' })).statusCode).toBe(400)
    expect(subject.captures).toEqual([])
    expect(subject.operations.owner('sim')).toBeUndefined()
  })

  it.each(['dark', 'dark-flat', 'bias'] as const)('refuses a filter on a %s run, which has none, but accepts None', async frameType => {
    const subject = setup(record.imagingCamera, { filters })

    expect((await subject.start({ exposureSeconds: 10, frameType, filter: 'L-Ultimate' })).statusCode).toBe(400)
    expect(subject.captures).toEqual([])
    expect((await subject.start({ exposureSeconds: 10, frameType, filter: null })).json()).toMatchObject({ filter: null })
  })

  it('resumes an interrupted run with its filter, even if the rig no longer lists it', async () => {
    const runs = createMemoryCaptureRunStore()
    const before = setup(record.imagingCamera, { filters, runs })

    await before.start({ exposureSeconds: 30, repeat: true, frameCount: 5, saveFrames: true, filter: 'L-Ultimate' })

    const after = setup(record.imagingCamera, { runs })

    expect((await after.get()).json()).toMatchObject({ phase: 'interrupted', filter: 'L-Ultimate' })

    const resumed = await after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume' })

    expect(resumed.json()).toMatchObject({ phase: 'exposing', filter: 'L-Ultimate' })
    expect(runs.unfinished('sim')).toMatchObject({ filter: 'L-Ultimate' })
  })

  it('resumes a run recorded before filters as unknown, not None', async () => {
    const runs = createMemoryCaptureRunStore()

    runs.save({
      version: 1,
      rigId: 'sim',
      runId: 'run-1',
      startedAt: '2026-10-25T03:00:00.000Z',
      exposureSeconds: 30,
      repeat: true,
      frameCount: 5,
      frameType: 'light',
      saveFrames: true,
      subject: null,
      unattended: false,
      completedCount: 2,
      savedCount: 2,
      integrationSeconds: 60,
    })

    const after = setup(record.imagingCamera, { runs })

    expect((await after.get()).json()).not.toHaveProperty('filter')

    const resumed = (await after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume' })).json()

    expect(resumed.phase).toBe('exposing')
    expect(resumed).not.toHaveProperty('filter')
  })
})

it('tells the alert monitor a calibration run is one, never lets it raise star alerts, and still shows the camera is producing', async () => {
  for (const frameType of ['dark', 'flat', 'dark-flat', 'bias'] as const) {
    const monitor = { runStarted: vi.fn(), frameCaptured: vi.fn(), runEnded: vi.fn(), runInterrupted: vi.fn(), setUnattended: vi.fn() }
    const subject = setup(record.imagingCamera, { alerts: { monitorFor: () => monitor } })
    const body = { exposureSeconds: 10, repeat: true, saveFrames: true, frameType }
    expect((await subject.start(body)).statusCode).toBe(200)
    expect(monitor.runStarted).toHaveBeenCalledExactlyOnceWith(10, { imaging: false, calibration: true, unattended: false })
    subject.captures[0]!.resolve(frame)
    await vi.waitFor(() => expect(monitor.frameCaptured).toHaveBeenCalledOnce())
    expect(monitor.frameCaptured).toHaveBeenCalledWith({ capturedAt: frame.capturedAt, statistics: null }, expect.any(String))
  }
})

it('starts a run attended unless asked, and tells the monitor and the run record what it asked', async () => {
  for (const [body, unattended] of [
    [{ exposureSeconds: 10, repeat: true }, false],
    [{ exposureSeconds: 10, repeat: true, unattended: false }, false],
    [{ exposureSeconds: 10, repeat: true, unattended: true }, true],
  ] as const) {
    const monitor = { runStarted: vi.fn(), frameCaptured: vi.fn(), runEnded: vi.fn(), runInterrupted: vi.fn(), setUnattended: vi.fn() }
    const runs = createMemoryCaptureRunStore()
    const subject = setup(record.imagingCamera, { alerts: { monitorFor: () => monitor }, runs })
    const started = await subject.start(body)

    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ unattended })
    expect(monitor.runStarted).toHaveBeenCalledExactlyOnceWith(10, { imaging: false, calibration: false, unattended })
    expect(runs.unfinished('sim')).toMatchObject({ unattended })
  }

  expect((await setup().start({ exposureSeconds: 10, unattended: 'yes' })).statusCode).toBe(400)
})

describe('switching Unattended', () => {
  const put = (subject: ReturnType<typeof setup>, payload: string, rigId = 'sim') =>
    subject.app.inject({ method: 'PUT', url: `/api/rigs/${rigId}/capture/unattended`, headers: { 'content-type': 'application/json' }, payload })

  it('changes a running run at any time, tells the monitor, and keeps the choice in the run record', async () => {
    const monitor = { runStarted: vi.fn(), frameCaptured: vi.fn(), runEnded: vi.fn(), runInterrupted: vi.fn(), setUnattended: vi.fn() }
    const runs = createMemoryCaptureRunStore()
    const subject = setup(record.imagingCamera, { alerts: { monitorFor: () => monitor }, runs })

    expect((await subject.start({ exposureSeconds: 10, repeat: true })).statusCode).toBe(200)

    const on = await put(subject, JSON.stringify({ on: true }))

    expect(on.statusCode).toBe(200)
    expect(on.json()).toMatchObject({ unattended: true, active: true })
    expect(monitor.setUnattended).toHaveBeenLastCalledWith(true)
    expect(runs.unfinished('sim')).toMatchObject({ unattended: true })
    expect((await subject.get()).json()).toMatchObject({ unattended: true })

    expect((await put(subject, JSON.stringify({ on: false }))).json()).toMatchObject({ unattended: false })
    expect(monitor.setUnattended).toHaveBeenLastCalledWith(false)
    expect(runs.unfinished('sim')).toMatchObject({ unattended: false })
  })

  it('refuses when no run is active, for a body that is not { on }, and for an unknown rig', async () => {
    const subject = setup()

    expect((await put(subject, JSON.stringify({ on: true }))).statusCode).toBe(409)

    await subject.start({ exposureSeconds: 10, repeat: true })

    expect((await put(subject, JSON.stringify({}))).statusCode).toBe(400)
    expect((await put(subject, JSON.stringify({ on: 1 }))).statusCode).toBe(400)
    expect((await put(subject, JSON.stringify({ on: true, extra: true }))).statusCode).toBe(400)
    expect((await put(subject, JSON.stringify({ on: true }), 'nope')).statusCode).toBe(404)
  })

  it('does not touch the interrupted view after a restart', async () => {
    const runs = createMemoryCaptureRunStore()
    const before = setup(record.imagingCamera, { runs })

    await before.start({ exposureSeconds: 10, repeat: true, unattended: true })

    const after = setup(record.imagingCamera, { runs })

    expect((await put(after, JSON.stringify({ on: false }))).statusCode).toBe(409)
    expect((await after.get()).json()).toMatchObject({ phase: 'interrupted', unattended: true })
  })
})

it('keeps star alerts for a light run that repeats and saves', async () => {
  const monitor = { runStarted: vi.fn(), frameCaptured: vi.fn(), runEnded: vi.fn(), runInterrupted: vi.fn(), setUnattended: vi.fn() }
  const subject = setup(record.imagingCamera, { alerts: { monitorFor: () => monitor } })
  const body = { exposureSeconds: 10, repeat: true, saveFrames: true, frameType: 'light' }
  expect((await subject.start(body)).statusCode).toBe(200)
  expect(monitor.runStarted).toHaveBeenCalledExactlyOnceWith(10, { imaging: true, calibration: false, unattended: false })
  subject.captures[0]!.resolve(frame)
  await vi.waitFor(() => expect(monitor.frameCaptured).toHaveBeenCalledOnce())
  expect(monitor.frameCaptured.mock.calls[0]![0].statistics).not.toBeNull()
})

describe('after the server restarts', () => {
  const monitor = () => ({ runStarted: vi.fn(), frameCaptured: vi.fn(), runEnded: vi.fn(), runInterrupted: vi.fn(), setUnattended: vi.fn() })

  /** A server that was killed with a run half done, and the one that replaces it. */
  async function restarted(
    body: InjectOptions['payload'] = { exposureSeconds: 30, repeat: true, frameCount: 5, saveFrames: true },
    framesTaken = 2,
  ) {
    const runs = createMemoryCaptureRunStore()
    const before = setup(record.imagingCamera, { runs })

    expect((await before.start(body)).statusCode).toBe(200)

    for (let taken = 0; taken < framesTaken; taken++) {
      before.captures[taken]!.resolve(frame)
      await vi.waitFor(() => expect(before.captures).toHaveLength(taken + 2))
    }

    const alerts = monitor()
    const after = setup(record.imagingCamera, { runs, alerts: { monitorFor: () => alerts } })
    const resume = () => after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume' })

    return { after, alerts, resume, runs }
  }

  it('shows the run as interrupted, with how far it got, and takes no exposure by itself', async () => {
    const { after } = await restarted()
    const view = (await after.get()).json()

    expect(view).toMatchObject({
      phase: 'interrupted',
      active: false,
      enabled: true,
      completedCount: 2,
      frameCount: 5,
      savedCount: 2,
      exposureSeconds: 30,
      interruption: { reason: 'Vela restarted', remainingCount: 3 },
    })

    expect(after.captures).toEqual([])
    expect(after.operations.owner('sim')).toBeUndefined()

    expect((await after.app.inject('/api/web/navigation')).json().captures).toMatchObject([
      { rigId: 'sim', phase: 'interrupted', active: false, completedCount: 2 },
    ])
  })

  it('resumes with the same settings and the frames that are left, under the usual lease', async () => {
    const { after, resume } = await restarted()
    const response = await resume()

    expect(response.statusCode).toBe(200)

    expect(response.json()).toMatchObject({
      phase: 'exposing',
      active: true,
      repeat: true,
      saveFrames: true,
      frameType: 'light',
      exposureSeconds: 30,
      frameCount: 3,
      completedCount: 0,
      interruption: null,
    })

    expect(after.captures).toHaveLength(1)
    expect(after.captures[0]).toMatchObject({ exposureSeconds: 30 })
    expect(after.operations.owner('sim')).toBe('capture')
    expect((await resume()).statusCode).toBe(409)
    expect(after.captures).toHaveLength(1)
  })

  it('resumes a calibration run as the same frame type, and a run with no count with none', async () => {
    const { after, resume } = await restarted({ exposureSeconds: 5, repeat: true, frameType: 'dark' }, 1)

    expect((await resume()).json()).toMatchObject({ frameType: 'dark', subject: null, frameCount: null, repeat: true })
    expect(after.captures).toHaveLength(1)
  })

  it('resumes the subject the run had, even if it can no longer be looked up', async () => {
    const subject = { targetId: 'm31', name: 'Andromeda Galaxy', catalog: 'M 31' }
    const runs = createMemoryCaptureRunStore()
    const before = setup(record.imagingCamera, { runs, lookupSubject: () => subject })

    await before.start({ exposureSeconds: 30, repeat: true, targetId: 'm31' })

    const after = setup(record.imagingCamera, { runs, lookupSubject: () => undefined })

    expect((await after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume' })).json()).toMatchObject({ subject })
  })

  it('obeys every start check: the lease, a busy camera and a disconnected one all refuse it', async () => {
    const { after, resume } = await restarted()

    const release = after.operations.acquire('sim', 'autofocus')!
    expect((await resume()).statusCode).toBe(409)
    release()

    after.externallyBusy()
    expect((await resume()).json().error).toMatch(/not confirmed it is idle/)

    after.disconnect()
    expect((await resume()).statusCode).toBe(409)
    expect(after.captures).toEqual([])
    expect((await after.get()).json().phase).toBe('interrupted')
  })

  it('refuses to resume when nothing was interrupted or nothing is left', async () => {
    const idle = setup()

    expect((await idle.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume' })).json().error).toMatch(/no interrupted run/)

    const runs = createMemoryCaptureRunStore()

    runs.save({
      version: 1,
      rigId: 'sim',
      runId: 'run-1',
      startedAt: '2026-10-25T03:00:00.000Z',
      exposureSeconds: 30,
      repeat: true,
      frameCount: 2,
      frameType: 'light',
      saveFrames: true,
      subject: null,
      unattended: false,
      completedCount: 2,
      savedCount: 2,
      integrationSeconds: 60,
    })

    const after = setup(record.imagingCamera, { runs })
    const response = await after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume' })

    expect(response.statusCode).toBe(409)
    expect(response.json().error).toMatch(/already taken all its frames/)
    expect(after.captures).toEqual([])
  })

  it.each(emptyHaltRequests)('resumes on %s', async (_name, options) => {
    const { after } = await restarted()

    expect((await after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume', ...options })).statusCode).toBe(200)
    expect(after.captures).toHaveLength(1)
  })

  it.each(refusedHaltRequests)('refuses a resume with %s and starts nothing', async (_name, options) => {
    const { after } = await restarted()
    const refused = await after.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/resume', ...options })

    expect(refused.statusCode).toBe(400)
    expect(refused.json()).toEqual({ error: haltBodyError })
    expect(after.captures).toEqual([])
  })

  it('tells the monitor once about an interrupted run, with whether it was Unattended', async () => {
    const attended = await restarted()

    await attended.after.get()
    await attended.after.get()

    expect(attended.alerts.runInterrupted).toHaveBeenCalledExactlyOnceWith(
      'Capture was interrupted: Vela restarted (2 of 5 frames taken)',
      false,
    )

    const unattended = await restarted({ exposureSeconds: 30, repeat: true, frameCount: 5, saveFrames: true, unattended: true })

    expect((await unattended.after.get()).json()).toMatchObject({ phase: 'interrupted', unattended: true })

    expect(unattended.alerts.runInterrupted).toHaveBeenCalledExactlyOnceWith(
      'Capture was interrupted: Vela restarted (2 of 5 frames taken)',
      true,
    )
  })

  it('tells the monitor about an interrupted calibration run, because a rig problem still matters', async () => {
    const { after, alerts } = await restarted({ exposureSeconds: 5, repeat: true, frameType: 'flat', unattended: true }, 1)

    expect((await after.get()).json().phase).toBe('interrupted')
    expect(alerts.runInterrupted).toHaveBeenCalledExactlyOnceWith(
      'Capture was interrupted: Vela restarted (1 frames taken)',
      true,
    )
  })

  it('resumes an Unattended run as Unattended', async () => {
    const { after, alerts, resume } = await restarted({ exposureSeconds: 30, repeat: true, frameCount: 5, saveFrames: true, unattended: true })

    expect((await resume()).json()).toMatchObject({ phase: 'exposing', unattended: true })
    expect(alerts.runStarted).toHaveBeenCalledExactlyOnceWith(30, { imaging: true, calibration: false, unattended: true })
    expect(after.captures).toHaveLength(1)
  })

  it('reports a run that a graceful shutdown ended, and not one that Chris stopped', async () => {
    const runs = createMemoryCaptureRunStore()
    const shutdown = setup(record.imagingCamera, { runs })

    await shutdown.start({ exposureSeconds: 30, repeat: true })
    const exposure = shutdown.captures[0]!

    exposure.signal.addEventListener('abort', () => exposure.reject(new CaptureStoppedError()))
    await shutdown.app.close()

    expect((await setup(record.imagingCamera, { runs }).get()).json().phase).toBe('interrupted')

    const stoppedRuns = createMemoryCaptureRunStore()
    const stopped = setup(record.imagingCamera, { runs: stoppedRuns })

    await stopped.start({ exposureSeconds: 30, repeat: true })
    const pending = stopped.captures[0]!

    pending.signal.addEventListener('abort', () => pending.reject(new CaptureStoppedError()))
    await stopped.app.inject({ method: 'POST', url: '/api/rigs/sim/capture/stop' })

    expect((await setup(record.imagingCamera, { runs: stoppedRuns }).get()).json().phase).toBe('idle')
  })
})
