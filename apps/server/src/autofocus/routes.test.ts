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

function setup() {
  const app = Fastify()
  const catalog = createMemoryRigCatalog([record])
  const operations = createRigOperations()
  let position = 32842
  const moves: number[] = []

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
      return { width: 8, height: 8, pixels: new Float64Array(64), capturedAt: '2026-09-17T00:00:00.000Z', color: { kind: 'mono' } }
    },
  }

  registerAutofocus(app, catalog, operations, {
    createInspector: () => ({ async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
      return [
        { providerDeviceId: 'camera', kind: 'camera', configuredName: 'Camera', name: 'Main camera', connection: 'connected',
          telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'idle' } } },
        { providerDeviceId: 'eaf', kind: 'focuser', configuredName: 'EAF', name: 'EAF', connection: 'connected',
          telemetry: { availability: 'complete', values: { kind: 'focuser', position, moving: false } } },
      ]
    } }),
    createCamera: () => camera,
    createFocuser: () => focuser,
    measure: async () => ({ detectedStars: 40, medianHfrPixels: hyperbola(position, 2.18, 95, 32838) }),
  })

  cleanups.push(async () => { await app.close() })

  return {
    get: () => app.inject({ method: 'GET', url: '/api/web/rigs/fra/autofocus' }),
    start: (body: object = { stepSize: 50 }) => app.inject({ method: 'POST', url: '/api/rigs/fra/autofocus/start', payload: body }),
    stop: () => app.inject({ method: 'POST', url: '/api/rigs/fra/autofocus/stop', payload: {} }),
    operations, moves,
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
  expect((await subject.get()).json()).toMatchObject({ enabled: true, samples: [], startPosition: null, currentPosition: 32842 })
  const started = await subject.start({ stepSize: 50, exposureSeconds: 2 })
  expect(started.statusCode).toBe(200)
  expect(started.json()).toMatchObject({ active: true, startPosition: 32842, phase: 'walking' })
  await vi.waitFor(async () => {
    const view = (await subject.get()).json()
    expect(view.samples.length).toBeGreaterThan(0)
  })
  const mid = (await subject.get()).json()
  expect(mid.samples[0].position).not.toBe(0)
  expect(mid.startPosition).toBe(32842)
  await vi.waitFor(async () => expect((await subject.get()).json().active).toBe(false), { timeout: 8000 })
  const done = (await subject.get()).json()
  expect(done.phase).toBe('complete')
  expect(done.fit.position).not.toBe(0)
  expect(subject.moves).not.toContain(0)
})
