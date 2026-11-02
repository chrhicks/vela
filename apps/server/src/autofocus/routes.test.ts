import { mkdtemp, open, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type InjectOptions } from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { buildApp } from '../app.js'
import { openRunLog, type RunLogOptions } from '../run-log/run-log.js'
import { decodeLine, type Envelope } from '@vela/rig-events'
import { autofocusRecordsOn, noAutofocusRecords, type AutofocusRecords } from './records.js'
import { registerAutofocus } from './routes.js'
import type { AutofocusCamera, AutofocusFocuser } from './controller.js'
import { hyperbola } from './hyperbola.js'
import { haltBodyError } from '../http/halt-body.js'
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

interface Air {
  temperatureC?: number
  interrupted?: boolean
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
  { travel = { maxStep: 60000 }, bestFocus = 32838, records = noAutofocusRecords, air }: {
    travel?: { minStep?: number; maxStep: number }
    bestFocus?: number
    records?: AutofocusRecords
    air?: Air
  } = {},
) {
  const app = Fastify()

  const rigInventory = air
    ? {
        ...inventory,
        devices: [
          ...inventory.devices,
          { uniqueId: 'ppba', kind: 'observing-conditions' as const, name: 'PPBA' },
        ],
      }
    : inventory

  const catalog = createMemoryRigCatalog([{ ...record, lastObservedInventory: rigInventory }])
  const conditions = { ...air }
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

  function conditionsDevice(): AlpacaDeviceInspection {
    const reading = { kind: 'observing-conditions' as const, humidityPercent: 60 }

    const device: AlpacaDeviceInspection = {
      providerDeviceId: 'ppba',
      kind: 'observing-conditions',
      configuredName: 'PPBA',
      name: 'PPBA',
      connection: 'connected',
      telemetry: {
        availability: 'complete',
        values:
          conditions.temperatureC === undefined
            ? reading
            : { ...reading, temperatureC: conditions.temperatureC },
      },
    }

    return conditions.interrupted
      ? { ...device, observation: { state: 'interrupted', commandReady: false } }
      : device
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
          ...(air ? [conditionsDevice()] : []),
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
    start: (
      body: {
        stepSize?: number
        offsetSteps?: number
        fineStepSize?: number
        fineOffsetSteps?: number
        confirmTolerance?: number
        exposureSeconds?: number
      } = { stepSize: 50 },
    ) =>
      app.inject({
        method: 'POST',
        url: '/api/rigs/fra/autofocus/start',
        payload: body,
      }),
    stop: (options: InjectOptions = {}) =>
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
    conditions,
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
    { fineStepSize: 0 },
    { fineOffsetSteps: 11 },
    { confirmTolerance: 0 },
    { confirmTolerance: 1.5 },
    { extra: true },
  ]) {
    expect((await subject.start(body)).statusCode).toBe(400)
  }

  expect(subject.operations.owner('fra')).toBeUndefined()
})

it('takes the coarse and fine passes and the confirm tolerance from the start body, and defaults them otherwise', async () => {
  const subject = setup()

  const started = await subject.start({
    stepSize: 100,
    offsetSteps: 3,
    fineStepSize: 20,
    fineOffsetSteps: 5,
    confirmTolerance: 0.2,
    exposureSeconds: 2,
  })

  expect(started.json()).toMatchObject({
    stepSize: 100,
    offsetSteps: 3,
    fineStepSize: 20,
    fineOffsetSteps: 5,
    confirmTolerance: 0.2,
  })
  await subject.finish()

  const defaults = setup()
  expect((await defaults.get()).json()).toMatchObject({ stepSize: 150, offsetSteps: 4, fineStepSize: 25, fineOffsetSteps: 6, confirmTolerance: 0.1 })
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
  const refused = await subject.stop(options)
  expect(refused.statusCode).toBe(400)
  expect(refused.json()).toEqual({ error: haltBodyError })
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

it('serves the run so far with its star tables, and files the settled run in the run log', async () => {
  const { records, close, events } = await runLogRecords()
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
  expect(done.samples).toHaveLength(23)
  expect(done.samples.at(-1)).toMatchObject({ pass: 'confirm' })
  expect(done).toMatchObject({ fineStepSize: 25, fineOffsetSteps: 6, confirmTolerance: 0.1 })
  await close()

  const [event, ...rest] = await events()
  const { version: _version, rigId: _rigId, ...body } = done

  expect(rest).toEqual([])
  expect(event).toMatchObject({ kind: 'autofocus', rig: 'fra', at: Date.parse(done.settledAt), body })
})

async function runLogRecords(options: Partial<RunLogOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'vela-autofocus-records-test-'))

  const log = openRunLog({ directory, retry: { firstMs: 5, lastMs: 20 }, onProblem: () => {}, ...options })
  cleanups.push(async () => {
    await log.close()
    await rm(directory, { recursive: true, force: true })
  })

  async function events() {
    const found: Envelope<'autofocus'>[] = []

    for (const name of await readdir(directory)) {
      for (const line of (await readFile(join(directory, name), 'utf8')).split('\n')) {
        const decoded = line === '' ? undefined : decodeLine(line)

        if (decoded?.ok && decoded.event.kind === 'autofocus') found.push(decoded.event)
      }
    }

    return found
  }

  return { log, records: autofocusRecordsOn(log), close: () => log.close(), events }
}

async function recordedRun(settle: (subject: ReturnType<typeof setup>) => Promise<void>, air?: Air) {
  const { records, close, events } = await runLogRecords()
  const subject = setup(32842, undefined, air ? { records, air } : { records })

  await settle(subject)
  await close()

  const [event, ...rest] = await events()

  expect(rest).toEqual([])

  return event!.body
}

it('keeps walking through a full disk, shows the run log error on /api/health, and drops nothing it can still write', async () => {
  const { log, records } = await runLogRecords({ openFile: () => open('/dev/full', 'a') })
  const subject = setup(32842, undefined, { records })
  const health = buildApp({ runLog: log })

  cleanups.push(() => health.close())
  await subject.start({ stepSize: 50, exposureSeconds: 2 })
  await subject.finish()

  expect((await subject.get()).json()).toMatchObject({ phase: 'complete' })
  await vi.waitFor(() => expect(log.health().state).toBe('retrying'))

  const answer = (await health.inject('/api/health')).json()

  expect(answer).toMatchObject({ status: 'ok', runLog: { state: 'retrying', lastError: { message: expect.stringContaining('ENOSPC') } } })
})

it('records the air temperature the rig page reads at the start and again at the end', async () => {
  const run = await recordedRun(async subject => {
    subject.conditions.temperatureC = 4.7
    await subject.start()
    subject.conditions.temperatureC = 5.2
    await subject.finish()
  }, { temperatureC: 4.7 })

  expect(run).toMatchObject({ phase: 'complete', airTemperatureC: { start: 4.7, end: 5.2 } })
})

it('leaves the air temperature null when the rig has no observing-conditions device', async () => {
  const run = await recordedRun(async subject => {
    await subject.start()
    await subject.finish()
  })

  expect(run).toMatchObject({ phase: 'complete', airTemperatureC: { start: null, end: null } })
})

it('does not record a last-known air temperature from an interrupted device', async () => {
  const run = await recordedRun(
    async subject => {
      await subject.start()
      await subject.finish()
    },
    { temperatureC: 9, interrupted: true },
  )

  expect(run.airTemperatureC).toEqual({ start: null, end: null })
})

it('records a null end temperature when the device stops reporting during the run', async () => {
  const run = await recordedRun(async subject => {
    await subject.start()
    delete subject.conditions.temperatureC
    await subject.finish()
  }, { temperatureC: 6.1 })

  expect(run).toMatchObject({ phase: 'complete', airTemperatureC: { start: 6.1, end: null } })
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

  expect(subject.moves).toEqual([16200, 15900, 15850, 15800, 15750, 15700, 15650, 15600, 15550, 15500, 16000, 15700])
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

  expect(subject.moves.slice(0, 10)).toEqual([701, 401, 351, 301, 251, 201, 151, 101, 51, 1])
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
