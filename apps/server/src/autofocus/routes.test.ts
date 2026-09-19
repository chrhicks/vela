import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { registerAutofocus } from './routes.js'
import type { AutofocusCamera, AutofocusFocuser } from './controller.js'
import { hyperbola } from './hyperbola.js'

const record = {
  id: 'fra', name: 'FRA 400', endpoint: { host: '127.0.0.1', port: 11111 },
  imagingCamera: { uniqueId: 'camera', name: 'Main camera' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T20:00:00.000Z',
    devices: [
      { uniqueId: 'camera', kind: 'camera' as const, name: 'Main camera' },
      { uniqueId: 'eaf', kind: 'focuser' as const, name: 'EAF' },
    ],
  },
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => { await Promise.all(cleanups.splice(0).map(cleanup => cleanup())) })

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = () => yes() })

  return { promise, resolve }
}

function setup(start = 32842, inventory = record.lastObservedInventory) {
  const app = Fastify()
  const catalog = createMemoryRigCatalog([{ ...record, lastObservedInventory: inventory }])
  const operations = createRigOperations()
  let position = start
  const moves: number[] = []
  const focuserIds: string[] = []
  const captures: Array<ReturnType<typeof deferred>> = []

  const focuser: AutofocusFocuser = {
    async status() { return { absolute: true, position, maxStep: 60000, moving: false } },
    async move(target) {
      expect(target).not.toBe(0)
      position = target
      moves.push(target)

      return { position }
    },
    async halt() {},
  }

  const camera: AutofocusCamera = {
    async capture() {
      const gate = deferred()
      captures.push(gate)
      await gate.promise

      return { width: 8, height: 8, pixels: new Float64Array(64), capturedAt: '2026-09-17T00:00:00.000Z', color: { kind: 'mono' } }
    },
  }

  registerAutofocus(app, catalog, operations, {
    createInspector: () => ({ async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
      return [
        { providerDeviceId: 'camera', kind: 'camera', configuredName: 'Camera', name: 'Main camera', connection: 'connected',
          telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'idle' } } },
        { providerDeviceId: 'eaf', kind: 'focuser', configuredName: 'EAF', name: 'EAF', connection: 'connected',
          telemetry: { availability: 'complete', values: { kind: 'focuser', position, moving: false, maxStep: 60000 } } },
      ]
    } }),
    createCamera: () => camera,
    createFocuser: settings => {
      focuserIds.push(settings.focuserId)

      return focuser
    },
    measure: async () => ({ detectedStars: 40, medianHfrPixels: hyperbola(position, 2.18, 95, 32838) }),
  })

  cleanups.push(async () => { await app.close() })

  return {
    get: () => app.inject({ method: 'GET', url: '/api/web/rigs/fra/autofocus' }),
    start: (body: { stepSize?: number, exposureSeconds?: number } = { stepSize: 50 }) => app.inject({ method: 'POST', url: '/api/rigs/fra/autofocus/start', payload: body }),
    stop: () => app.inject({ method: 'POST', url: '/api/rigs/fra/autofocus/stop', payload: {} }),
    land: async () => {
      await vi.waitFor(() => expect(captures.length).toBeGreaterThan(0))
      captures.shift()!.resolve()
    },
    finish: async () => {
      const deadline = Date.now() + 8000

      while (Date.now() < deadline) {
        if (!(await app.inject({ method: 'GET', url: '/api/web/rigs/fra/autofocus' })).json().active) return

        if (captures.length) captures.shift()!.resolve()
        await new Promise(resolve => setTimeout(resolve, 5))
      }

      throw new Error('Autofocus walk did not finish')
    },
    operations, moves, focuserIds,
  }
}

it('rejects malformed start bodies before acquiring the rig', async () => {
  const subject = setup()

  for (const body of [{ stepSize: 0 }, { stepSize: 50.5 }, { exposureSeconds: 0 }, { extra: true }]) {
    expect((await subject.start(body)).statusCode).toBe(400)
  }

  expect(subject.operations.owner('fra')).toBeUndefined()
})

it('publishes samples onto the live view as the walk runs', async () => {
  const subject = setup()
  expect((await subject.get()).json()).toMatchObject({ enabled: true, samples: [], startPosition: null, currentPosition: 32842, maxStep: 60000 })
  const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
  expect(started.statusCode).toBe(200)
  expect(started.json()).toMatchObject({ active: true, startPosition: 32842, phase: 'walking', samples: [] })
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

it('returns to setup for a travel-limit start without moving', async () => {
  const subject = setup(80)
  const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
  expect(started.statusCode).toBe(200)
  expect(started.json()).toMatchObject({ phase: 'setup', active: false, startPosition: null, currentPosition: 80, restoredStart: false })
  expect(started.json().error).toMatch(/MaxStep|0/)
  expect(subject.moves).toEqual([])
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
