import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type InjectOptions } from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { openJsonlRecords } from '../records.js'
import { noAutofocusRecords, registerAutofocus, type AutofocusRecords } from './routes.js'
import type { AutofocusCamera, AutofocusFocuser } from './controller.js'
import { hyperbola } from './hyperbola.js'
import { emptyHaltRequests, refusedHaltRequests } from '../http/halt-requests.fixture.js'

const record = {
  id: 'fra',
  name: 'FRA 400',
  endpoint: { host: '127.0.0.1', port: 11111 },
  imagingCamera: { uniqueId: 'camera', name: 'Main camera' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: {
    observedAt: '2026-09-01T20:00:00.000Z',
    devices: [
      { uniqueId: 'camera', kind: 'camera' as const, name: 'Main camera' },
      { uniqueId: 'eaf', kind: 'focuser' as const, name: 'EAF' },
    ],
  },
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

function deferred() {
  let resolve!: () => void

  const promise = new Promise<void>(yes => {
    resolve = () => yes()
  })

  return { promise, resolve }
}

function setup(
  start = 32842,
  inventory = record.lastObservedInventory,
  { travel = { maxStep: 60000 }, bestFocus = 32838, records = noAutofocusRecords }: {
    travel?: { minStep?: number; maxStep: number }
    bestFocus?: number
    records?: AutofocusRecords
  } = {},
) {
  const app = Fastify()
  const catalog = createMemoryRigCatalog([{ ...record, lastObservedInventory: inventory }])
  const operations = createRigOperations()
  let position = start
  const moves: number[] = []
  const windows: Array<{ minPosition: number; maxPosition: number }> = []
  const focuserIds: string[] = []
  const captures: Array<ReturnType<typeof deferred>> = []

  const focuser: AutofocusFocuser = {
    async status() {
      return { absolute: true, position, moving: false, ...travel }
    },
    async move(target, window) {
      expect(target).not.toBe(0)
      position = target
      moves.push(target)
      windows.push(window)

      return { position }
    },
    async halt() {},
  }

  const camera: AutofocusCamera = {
    async capture() {
      const gate = deferred()
      captures.push(gate)
      await gate.promise

      return {
        width: 8,
        height: 8,
        pixels: new Float64Array(64),
        capturedAt: '2026-09-17T00:00:00.000Z',
        color: { kind: 'mono' },
      }
    },
  }

  registerAutofocus(app, catalog, operations, {
    createInspector: () => ({
      async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
        return [
          {
            providerDeviceId: 'camera',
            kind: 'camera',
            configuredName: 'Camera',
            name: 'Main camera',
            connection: 'connected',
            telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'idle' } },
          },
          {
            providerDeviceId: 'eaf',
            kind: 'focuser',
            configuredName: 'EAF',
            name: 'EAF',
            connection: 'connected',
            telemetry: {
              availability: 'complete',
              values: { kind: 'focuser', position, moving: false, ...travel },
            },
          },
        ]
      },
    }),
    createAcquisition: () => { throw new Error('Autofocus tests expose through createCamera') },
    createFocuserAdapter: () => { throw new Error('Autofocus tests move through createFocuser') },
    createCamera: () => camera,
    createFocuser: settings => {
      focuserIds.push(settings.focuserId)

      return focuser
    },
    measure: async () => ({
      algorithm: { version: 2 },
      detectedStars: 40,
      medianHfrPixels: hyperbola(position, 2.18, 95, bestFocus),
      stars: [{ x: 10, y: 20, snr: 300, hfr: position / 10000 }],
    }),
    records,
  })

  cleanups.push(async () => {
    await app.close()
  })

  return {
    get: () => app.inject({ method: 'GET', url: '/api/web/rigs/fra/autofocus' }),
    getRun: () => app.inject({ method: 'GET', url: '/api/web/rigs/fra/autofocus/run' }),
    start: (body: { stepSize?: number; exposureSeconds?: number } = { stepSize: 50 }) =>
      app.inject({
        method: 'POST',
        url: '/api/rigs/fra/autofocus/start',
        payload: body,
      }),
    stop: (options: InjectOptions = { payload: {} }) =>
      app.inject({ method: 'POST', url: '/api/rigs/fra/autofocus/stop', ...options }),
    land: async () => {
      await vi.waitFor(() => expect(captures.length).toBeGreaterThan(0))
      captures.shift()!.resolve()
    },
    finish: async () => {
      const deadline = Date.now() + 8000

      while (Date.now() < deadline) {
        if (
          !(await app.inject({ method: 'GET', url: '/api/web/rigs/fra/autofocus' })).json().active
        )
          return

        if (captures.length) captures.shift()!.resolve()
        await new Promise(resolve => setTimeout(resolve, 5))
      }

      throw new Error('Autofocus walk did not finish')
    },
    operations,
    moves,
    windows,
    focuserIds,
  }
}

it('rejects malformed start bodies before acquiring the rig', async () => {
  const subject = setup()

  for (const body of [
    { stepSize: 0 },
    { stepSize: 50.5 },
    { exposureSeconds: 0 },
    { extra: true },
  ]) {
    expect((await subject.start(body)).statusCode).toBe(400)
  }

  expect(subject.operations.owner('fra')).toBeUndefined()
})

it.each(emptyHaltRequests)('accepts a stop with %s', async (_name, options) => {
  const subject = setup()
  expect((await subject.start()).statusCode).toBe(200)
  await vi.waitFor(() => expect(subject.get().then(response => response.json().active)).resolves.toBe(true))
  const stopping = subject.stop(options)
  await subject.finish()
  expect((await stopping).statusCode).toBe(200)
  expect((await subject.get()).json()).toMatchObject({ active: false })
})

it.each(refusedHaltRequests)('refuses a stop with %s and leaves the walk going', async (_name, options) => {
  const subject = setup()
  expect((await subject.start()).statusCode).toBe(200)
  expect((await subject.stop(options)).statusCode).toBe(400)
  expect((await subject.get()).json()).toMatchObject({ active: true })
  await subject.finish()
})

it('publishes samples onto the live view as the walk runs', async () => {
  const subject = setup()
  expect((await subject.get()).json()).toMatchObject({
    enabled: true,
    samples: [],
    startPosition: null,
    currentPosition: 32842,
    maxStep: 60000,
  })
  const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
  expect(started.statusCode).toBe(200)
  expect(started.json()).toMatchObject({
    active: true,
    startPosition: 32842,
    phase: 'walking',
    samples: [],
  })
  await subject.land()
  await vi.waitFor(async () => {
    const view = (await subject.get()).json()
    expect(view.samples.length).toBe(1)
  })
  const mid = (await subject.get()).json()
  expect(mid.samples[0].position).not.toBe(0)
  expect(mid.startPosition).toBe(32842)
  expect(mid.fit).toBeNull()
  await subject.finish()
  const done = (await subject.get()).json()
  expect(done.phase).toBe('complete')
  expect(done.fit.position).not.toBe(0)
  expect(subject.moves).not.toContain(0)
})

it('serves the run so far with its star tables, and appends the settled run to the records file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-autofocus-records-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'nested', 'autofocus.jsonl')
  const records: AutofocusRecords = openJsonlRecords(file, { name: 'autofocus records' })
  const subject = setup(32842, undefined, { records })

  expect((await subject.getRun()).statusCode).toBe(404)
  await subject.start({ stepSize: 50, exposureSeconds: 2 })
  await subject.land()
  await vi.waitFor(async () => expect((await subject.get()).json().samples).toHaveLength(1))

  const mid = (await subject.getRun()).json()
  expect(mid).toMatchObject({ version: 1, rigId: 'fra', settledAt: null, phase: 'walking' })
  expect(mid.samples).toHaveLength(1)
  expect(mid.samples[0].stars).toEqual([{ x: 10, y: 20, snr: 300, hfr: mid.samples[0].position / 10000 }])
  expect((await subject.get()).json().samples[0]).not.toHaveProperty('stars')

  await subject.finish()
  const done = (await subject.getRun()).json()
  expect(done).toMatchObject({ phase: 'complete', fit: { position: expect.any(Number) } })
  expect(done.settledAt).not.toBeNull()
  expect(done.samples).toHaveLength(10)
  await records.close()

  const lines = (await readFile(file, 'utf8')).trimEnd().split('\n')

  expect(lines).toHaveLength(1)
  expect(JSON.parse(lines[0]!)).toEqual(done)
})

it('returns to setup for a travel-limit start without moving', async () => {
  const subject = setup(80)
  const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
  expect(started.statusCode).toBe(200)
  expect(started.json()).toMatchObject({
    phase: 'setup',
    active: false,
    startPosition: null,
    currentPosition: 80,
    restoredStart: false,
  })
  expect(started.json().error).toMatch(/leave the focuser travel/)
  expect(subject.moves).toEqual([])
})

it('walks from the low end of the reported travel and commands MinStep itself', async () => {
  const subject = setup(15700, record.lastObservedInventory, {
    travel: { minStep: 15500, maxStep: 38000 },
    bestFocus: 15300,
  })

  expect((await subject.get()).json()).toMatchObject({
    enabled: true,
    currentPosition: 15700,
    minStep: 15500,
    maxStep: 38000,
  })
  expect((await subject.start({ stepSize: 50, exposureSeconds: 2 })).json())
    .toMatchObject({ active: true, phase: 'walking', minStep: 15500 })
  await subject.finish()

  expect(subject.moves).toEqual([15900, 15850, 15800, 15750, 15700, 15650, 15600, 15550, 15500, 16000, 15700])
  expect(Math.min(...subject.windows.map(window => window.minPosition))).toBe(15500)
  expect((await subject.get()).json()).toMatchObject({ phase: 'failed', restoredStart: true })
})

it('walks from the high end of the reported travel and commands MaxStep itself', async () => {
  const subject = setup(37800, record.lastObservedInventory, {
    travel: { minStep: 15500, maxStep: 38000 },
    bestFocus: 15300,
  })

  expect((await subject.start({ stepSize: 50, exposureSeconds: 2 })).json())
    .toMatchObject({ active: true, phase: 'walking' })
  await subject.finish()

  expect(subject.moves.slice(0, 9)).toEqual([38000, 37950, 37900, 37850, 37800, 37750, 37700, 37650, 37600])
  expect(Math.max(...subject.moves)).toBe(38000)
  expect(Math.max(...subject.windows.map(window => window.maxPosition))).toBe(38000)
})

it('refuses a start outside the reported travel without moving', async () => {
  for (const position of [15499, 38001, 15699, 37801]) {
    const subject = setup(position, record.lastObservedInventory, {
      travel: { minStep: 15500, maxStep: 38000 },
    })

    const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
    expect(started.json()).toMatchObject({ phase: 'setup', active: false, startPosition: null })
    expect(started.json().error).toMatch(/travel/)
    expect(subject.moves).toEqual([])
  }
})

it('keeps the legacy floor of 1 and ceiling below MaxStep when the focuser reports no MinStep', async () => {
  const subject = setup(201, record.lastObservedInventory, {
    travel: { maxStep: 60000 },
    bestFocus: 15300,
  })

  await subject.start({ stepSize: 50, exposureSeconds: 2 })
  await subject.finish()

  expect(subject.moves.slice(0, 9)).toEqual([401, 351, 301, 251, 201, 151, 101, 51, 1])
  expect(Math.min(...subject.windows.map(window => window.minPosition))).toBe(1)
  expect(subject.moves).not.toContain(0)
})

it('starts the inspected focuser when last-observed inventory does not list it', async () => {
  const subject = setup(32842, {
    ...record.lastObservedInventory,
    devices: [{ uniqueId: 'camera', kind: 'camera', name: 'Main camera' }],
  })

  expect((await subject.get()).json()).toMatchObject({ enabled: true, focuserName: 'EAF' })
  const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
  expect(started.statusCode).toBe(200)
  expect(started.json()).toMatchObject({ active: true, phase: 'walking' })
  expect(subject.focuserIds).toEqual(['eaf'])
  await subject.finish()
})

it('starts the inspected focuser when last-observed inventory lists a different one', async () => {
  const subject = setup(32842, {
    ...record.lastObservedInventory,
    devices: [
      { uniqueId: 'camera', kind: 'camera', name: 'Main camera' },
      { uniqueId: 'stale-eaf', kind: 'focuser', name: 'Stale EAF' },
    ],
  })

  expect((await subject.get()).json().enabled).toBe(true)
  expect((await subject.start({ stepSize: 50, exposureSeconds: 2 })).statusCode).toBe(200)
  expect(subject.focuserIds).toEqual(['eaf'])
  await subject.finish()
})
