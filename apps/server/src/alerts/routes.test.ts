import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AlpacaDeviceInspection } from '@vela/alpaca'
import * as statistics from '../imaging/statistics.js'
import { CaptureStoppedError, type CaptureCamera, type CaptureFrame } from '../capture/controller.js'
import { registerCapture } from '../capture/routes.js'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import { createRigOperations } from '../rig/operations.js'
import { NotifierError, type Notification, type Notifier } from './notifier.js'
import { registerAlerts } from './routes.js'
import { defaultThresholds } from './thresholds.js'

const rig = {
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

const jsonBody = { 'content-type': 'application/json' }

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

interface FakePhone {
  sent: Notification[]
  cancelled: string[]
  /** While set, every call fails with this reason. */
  down: string | null
}

function fakePhone() {
  const sent: Notification[] = []
  const cancelled: string[] = []
  const phone: FakePhone = { sent, cancelled, down: null }

  const notifier: Notifier = {
    async send(notification) {
      if (phone.down) throw new NotifierError(phone.down)

      sent.push(notification)

      return { receipt: notification.priority === 2 ? `receipt-${sent.length}` : null }
    },
    async cancel(receipt) {
      if (phone.down) throw new NotifierError(phone.down)

      cancelled.push(receipt)
    },
  }

  return { phone, notifier }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function setup(options: { keys?: boolean; now?: () => number } = {}) {
  const app = Fastify()
  const catalog = createMemoryRigCatalog([rig])
  const { phone, notifier } = fakePhone()

  const alerts = registerAlerts(app, catalog, {
    thresholds: defaultThresholds,
    notifier: options.keys === false ? null : notifier,
    ...(options.now && { now: options.now }),
  })

  cleanups.push(() => app.close())

  const post = (url: string) => app.inject({ method: 'POST', url, headers: jsonBody, payload: {} })

  return { app, catalog, alerts, phone, post }
}

describe('alerts routes', () => {
  it('reports an idle rig as not being watched, with the thresholds in use', async () => {
    const { app } = setup()

    const response = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      rigId: 'sim',
      watching: false,
      alerts: [],
      unavailable: [],
      phone: { state: 'ready' },
      thresholds: { starsCollapsedRatio: 0.15, hfrBadPixels: 6, meridianTrackLimitHours: 0.0669 },
    })
  })

  it('says phone alerts are not configured when there are no keys, and refuses a test', async () => {
    const { app, post } = setup({ keys: false })

    const view = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
    expect(view.json().phone).toEqual({ state: 'not-configured' })

    const test = await post('/api/rigs/sim/alerts/test')
    expect(test.statusCode).toBe(409)
    expect(test.json()).toEqual({ error: 'phone-alerts-not-configured' })
  })

  it('sends the test to the phone as a normal message', async () => {
    const { phone, post } = setup()

    const response = await post('/api/rigs/sim/alerts/test')

    expect(response.statusCode).toBe(200)
    expect(phone.sent).toEqual([{ title: 'Vela: Simulator', message: 'test', priority: 0 }])
  })

  it('shows a failed test with its reason and marks phone alerts failing', async () => {
    const { app, phone, post } = setup()
    phone.down = 'Pushover answered HTTP 429'

    const response = await post('/api/rigs/sim/alerts/test')

    expect(response.statusCode).toBe(502)
    expect(response.json()).toEqual({ error: 'phone-alerts-failing', reason: 'Pushover answered HTTP 429' })

    const view = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
    expect(view.json().phone).toMatchObject({ state: 'failing', reason: 'Pushover answered HTTP 429' })
  })

  it('has no phone alerts switch: the phone is paged by the run being Unattended', async () => {
    const { app } = setup()

    const view = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
    expect(view.json()).toMatchObject({ unattended: false })
    expect(view.json()).not.toHaveProperty('phoneAlertsOn')
    expect(view.json()).not.toHaveProperty('pagingWindow')

    const put = await app.inject({ method: 'PUT', url: '/api/rigs/sim/alerts/phone', headers: jsonBody, payload: { on: false } })
    expect(put.statusCode).toBe(404)
  })

  it('sends a test whatever the run', async () => {
    const { phone, post } = setup()

    expect((await post('/api/rigs/sim/alerts/test')).statusCode).toBe(200)
    expect(phone.sent).toEqual([{ title: 'Vela: Simulator', message: 'test', priority: 0 }])
  })

  it('answers 404 for an unknown rig on every route', async () => {
    const { app, post } = setup()

    expect((await app.inject({ method: 'GET', url: '/api/web/rigs/nope/alerts' })).statusCode).toBe(404)
    expect((await post('/api/rigs/nope/alerts/test')).statusCode).toBe(404)
    expect((await post('/api/rigs/nope/alerts/run-failed/acknowledge')).statusCode).toBe(404)
  })

  it('rejects a body that is not an empty JSON object', async () => {
    const { app } = setup()

    const response = await app.inject({
      method: 'POST',
      url: '/api/rigs/sim/alerts/test',
      headers: jsonBody,
      payload: { rigId: 'other' },
    })

    expect(response.statusCode).toBe(400)
  })

  describe('with a failed run', () => {
    async function failedRun() {
      const fixture = setup()
      const monitor = fixture.alerts.monitorFor({ id: 'sim', name: 'Simulator' })

      monitor.runStarted(60, { imaging: true, unattended: true })
      monitor.runEnded('failed')
      await settle()

      return fixture
    }

    it('lists the active alert, and acknowledging it stops the phone while it stays up', async () => {
      const { app, phone, post } = await failedRun()

      expect(phone.sent).toEqual([{ title: 'Vela: Simulator', message: 'The capture run failed', priority: 2 }])

      const acknowledged = await post('/api/rigs/sim/alerts/run-failed/acknowledge')

      expect(acknowledged.statusCode).toBe(200)
      expect(acknowledged.json().alerts).toEqual([
        expect.objectContaining({ id: 'run-failed', level: 'critical', acknowledged: true }),
      ])
      expect(phone.cancelled).toEqual(['receipt-1'])

      const view = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
      expect(view.json().alerts).toHaveLength(1)
    })

    it('does not call it acknowledged when the phone could not be told to stop', async () => {
      const { app, phone, post } = await failedRun()
      phone.down = 'could not reach Pushover'

      const response = await post('/api/rigs/sim/alerts/run-failed/acknowledge')

      expect(response.statusCode).toBe(502)
      expect(response.json()).toEqual({ error: 'phone-cancel-failed', reason: 'could not reach Pushover' })

      const view = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
      expect(view.json().alerts[0]).toMatchObject({ id: 'run-failed', acknowledged: false })
    })

    it('sends the emergency once the phone is back, though the run has ended and nothing else is polling', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const { app, alerts, phone } = setup()
      const monitor = alerts.monitorFor({ id: 'sim', name: 'Simulator' })
      phone.down = 'Pushover answered HTTP 503'

      monitor.runStarted(60, { imaging: true, unattended: true })
      monitor.runEnded('failed')
      await vi.advanceTimersByTimeAsync(0)

      const failing = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
      expect(failing.json()).toMatchObject({
        watching: false,
        phone: { state: 'failing' },
        alerts: [{ id: 'run-failed', delivery: { state: 'retrying', failures: 1 } }],
      })
      expect(phone.sent).toEqual([])

      phone.down = null
      await vi.advanceTimersByTimeAsync(65_000)

      const recovered = await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })
      expect(recovered.json().phone).toEqual({ state: 'ready' })
      expect(recovered.json().alerts[0].delivery).toEqual({ state: 'sent' })
      expect(phone.sent).toEqual([{ title: 'Vela: Simulator', message: 'The capture run failed', priority: 2 }])
    })

    it('answers 404 for an alert that is not raised', async () => {
      const { post } = await failedRun()

      const response = await post('/api/rigs/sim/alerts/stars-collapsed/acknowledge')

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'alert-not-active' })
    })
  })
})

// ---------------------------------------------------------------------------
// A capture run, through the real capture routes

describe('a capture run feeds the alerts', () => {
  const frame: CaptureFrame = {
    width: 2,
    height: 2,
    pixels: [0, 100, 400, 1000],
    capturedAt: '2026-09-05T16:00:00Z',
  }

  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void

    const promise = new Promise<T>((yes, no) => {
      resolve = yes
      reject = no
    })

    return { promise, resolve, reject }
  }

  function runningRig(options: { cameraFails?: boolean } = {}) {
    const app = Fastify()
    const catalog = createMemoryRigCatalog([rig])
    const { phone, notifier } = fakePhone()
    const captures: Array<ReturnType<typeof deferred<CaptureFrame>>> = []
    const alerts = registerAlerts(app, catalog, { thresholds: defaultThresholds, notifier })

    const capture: CaptureCamera = {
      capture({ signal }) {
        const result = deferred<CaptureFrame>()
        captures.push(result)
        signal.addEventListener('abort', () => result.reject(new CaptureStoppedError()))

        return result.promise
      },
    }

    registerCapture(app, catalog, createRigOperations(), {
      alerts,
      createAcquisition: () => {
        throw new Error('This test exposes through createCamera')
      },
      createCooling: () => {
        throw new Error('This test configures no cooling')
      },
      createCamera: () => {
        if (options.cameraFails) throw new Error('The configured Cria equipment connection is unavailable.')

        return capture
      },
      createInspector: () => ({
        async inspectDevices(): Promise<ReadonlyArray<AlpacaDeviceInspection>> {
          return [
            {
              providerDeviceId: 'camera',
              kind: 'camera',
              configuredName: 'Simulator camera',
              name: 'Main camera',
              connection: 'connected',
              telemetry: { availability: 'complete', values: { kind: 'camera', activity: 'idle' } },
            },
          ]
        },
      }),
    })

    cleanups.push(() => app.close())

    return {
      app,
      phone,
      captures,
      start: (unattended = true) =>
        app.inject({
          method: 'POST',
          url: '/api/rigs/sim/capture/start',
          headers: jsonBody,
          payload: { exposureSeconds: 60, repeat: true, unattended },
        }),
      switchUnattended: (on: boolean) =>
        app.inject({ method: 'PUT', url: '/api/rigs/sim/capture/unattended', headers: jsonBody, payload: { on } }),
      stop: () => app.inject({ method: 'POST', url: '/api/rigs/sim/capture/stop' }),
      alerts: async () => (await app.inject({ method: 'GET', url: '/api/web/rigs/sim/alerts' })).json(),
    }
  }

  /** Each frame the controller publishes is measured as if it held this many stars. */
  function measuredStars(counts: number[]) {
    const remaining = [...counts]

    vi.spyOn(statistics, 'measureStars').mockImplementation(async () => {
      const stars = remaining.shift() ?? 0

      return {
        algorithm: { version: statistics.starAlgorithmVersion },
        detectedStars: stars,
        medianHfrPixels: 3,
        detections: stars,
        measured: stars,
        strong: stars,
        rejected: { blended: 0, edge: 0, unconverged: 0, faint: 0, saturated: 0, wings: 0, elongated: 0, floor: 0 },
        sky: 100,
        noise: 1,
        axisRatio: null,
      }
    })
  }

  it('raises one emergency when the stars vanish, and clears it when the run is stopped', async () => {
    measuredStars([1200, 1250, 1180, 0, 0])
    const subject = runningRig()

    expect((await subject.start()).statusCode).toBe(200)
    expect(await subject.alerts()).toMatchObject({ watching: true, alerts: [] })

    for (let index = 0; index < 5; index++) {
      await vi.waitFor(() => expect(subject.captures).toHaveLength(index + 1))
      subject.captures[index]!.resolve(frame)
      await vi.waitFor(async () => expect((await subject.app.inject({ method: 'GET', url: '/api/web/rigs/sim/capture' })).json().completedCount).toBe(index + 1))
    }

    await settle()
    expect((await subject.alerts()).alerts).toEqual([expect.objectContaining({ id: 'stars-collapsed', level: 'critical' })])
    expect(subject.phone.sent.filter(message => message.priority === 2)).toHaveLength(1)

    await subject.stop()
    await settle()

    expect(await subject.alerts()).toMatchObject({ watching: false, alerts: [] })
    expect(subject.phone.cancelled).toEqual(['receipt-1'])
    expect(subject.phone.sent.at(-1)).toMatchObject({ priority: -1 })
  })

  it('does not watch a run that never started', async () => {
    const subject = runningRig({ cameraFails: true })

    expect((await subject.start()).statusCode).toBe(409)
    expect(await subject.alerts()).toMatchObject({ watching: false, alerts: [] })
  })

  it('raises run-failed when the camera fails mid-run, but not when Chris stops the run', async () => {
    const failing = runningRig()

    await failing.start()
    await vi.waitFor(() => expect(failing.captures).toHaveLength(1))
    failing.captures[0]!.reject(new Error('Camera disconnected'))

    await vi.waitFor(async () => expect((await failing.alerts()).alerts).toEqual([expect.objectContaining({ id: 'run-failed' })]))
    expect(failing.phone.sent).toEqual([expect.objectContaining({ priority: 2, title: 'Vela: Simulator' })])

    const stopped = runningRig()

    await stopped.start()
    await vi.waitFor(() => expect(stopped.captures).toHaveLength(1))
    await stopped.stop()

    expect(await stopped.alerts()).toMatchObject({ watching: false, alerts: [] })
    expect(stopped.phone.sent).toEqual([])
  })

  it('shows but does not page the failure of a run started without Unattended', async () => {
    const attended = runningRig()

    expect((await attended.start(false)).json()).toMatchObject({ unattended: false })
    expect(await attended.alerts()).toMatchObject({ unattended: false })
    await vi.waitFor(() => expect(attended.captures).toHaveLength(1))
    attended.captures[0]!.reject(new Error('Camera disconnected'))

    await vi.waitFor(async () =>
      expect((await attended.alerts()).alerts).toEqual([
        expect.objectContaining({ id: 'run-failed', delivery: { state: 'attended' } }),
      ]),
    )

    expect(attended.phone.sent).toEqual([])
  })

  it('switches Unattended on during a run, pages the failure that follows, and refuses once the run has ended', async () => {
    const subject = runningRig()

    await subject.start(false)
    await vi.waitFor(() => expect(subject.captures).toHaveLength(1))

    const on = await subject.switchUnattended(true)
    expect(on.statusCode).toBe(200)
    expect(on.json()).toMatchObject({ unattended: true, active: true })
    expect(await subject.alerts()).toMatchObject({ unattended: true })

    subject.captures[0]!.reject(new Error('Camera disconnected'))
    await vi.waitFor(() => expect(subject.phone.sent).toEqual([expect.objectContaining({ priority: 2 })]))

    const off = await subject.switchUnattended(false)
    expect(off.statusCode).toBe(409)
    expect(off.json().error).toMatch(/no running capture/)
  })

  it('switches Unattended off during a run, and the alerts view follows', async () => {
    const subject = runningRig()

    await subject.start()
    await vi.waitFor(() => expect(subject.captures).toHaveLength(1))

    expect((await subject.switchUnattended(false)).json()).toMatchObject({ unattended: false })
    expect(await subject.alerts()).toMatchObject({ unattended: false })
  })

  it('refuses to switch Unattended when no run is active, on a body that is not { on }, and for an unknown rig', async () => {
    const subject = runningRig()

    expect((await subject.switchUnattended(true)).statusCode).toBe(409)

    await subject.start()

    const put = (url: string, payload: unknown) => subject.app.inject({ method: 'PUT', url, headers: jsonBody, payload: payload as string })

    expect((await put('/api/rigs/sim/capture/unattended', {})).statusCode).toBe(400)
    expect((await put('/api/rigs/sim/capture/unattended', { on: 'yes' })).statusCode).toBe(400)
    expect((await put('/api/rigs/sim/capture/unattended', { on: true, extra: 1 })).statusCode).toBe(400)
    expect((await put('/api/rigs/nope/capture/unattended', { on: true })).statusCode).toBe(404)
  })
})
