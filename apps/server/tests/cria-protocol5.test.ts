import { randomUUID } from 'node:crypto'
import type { InjectOptions, LightMyRequestResponse } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { FakeCria, type Route } from '../../../packages/cria/test/v5/fake-cria.js'
import { buildApp } from '../src/app.js'
import type { FrameImaging } from '../src/imaging/frame-imaging.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { registerConfiguredCriaRigs, type CriaRigConfiguration } from '../src/equipment/config.js'
import type { PlateSolver } from '../src/plate-solving/solver.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'

let cria: FakeCria

let app: ReturnType<typeof buildApp>

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('This test has no network')))
  cria = new FakeCria()
})

afterEach(async () => {
  await drainImmediateWork(app.close())
  cria.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// The real frame pipeline yields to the event loop and waits on the zlib thread
// pool. The fake clock advances neither, so it finished or not depending on how
// busy the machine was. These settle in microtasks, which every advance drains.
// The pipeline has its own tests.
const images: FrameImaging = {
  render: async () => ({ native: Buffer.from('native'), fit: undefined }),
  analyze: async () => ({ algorithm: { version: 2 }, detectedStars: 0, medianHfrPixels: null }),
  encodeFits: async () => Buffer.from('fits'),
}

const slewToNgc7000 = { targetId: 'ngc7000', raDegrees: 314.7, decDegrees: 44.3, exposureSeconds: 1 }

const mountView = 'fixture-cria:fixture:mount'

const solver: PlateSolver = {
  async solve(frame, hint) {
    return {
      status: 'solved',
      capturedAt: frame.capturedAt,
      raDegrees: hint.raDegrees,
      decDegrees: hint.decDegrees,
      wcs: {
        width: frame.width,
        height: frame.height,
        referenceX: 2,
        referenceY: 1.5,
        raDegrees: hint.raDegrees,
        decDegrees: hint.decDegrees,
        cd: [0.001, 0, 0, -0.001],
      },
    }
  },
}

async function openAndInspectRig(): Promise<void> {
  const configuration: CriaRigConfiguration = {
    id: 'fixture',
    name: 'Fixture',
    url: cria.origin,
    devices: [
      { id: 'camera', kind: 'camera', expectedName: 'Fake CCD' },
      { id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' },
      { id: 'focuser', kind: 'focuser', expectedName: 'Fake Focuser' },
    ],
    imagingCameraId: 'camera',
    focalLengthMm: 400,
  }

  const rigCatalog = createMemoryRigCatalog()

  await registerConfiguredCriaRigs(rigCatalog, [configuration])

  app = buildApp({
    equipment: createEquipmentComposition([configuration], { fetch: cria.fetch }),
    rigCatalog,
    images,
    targets: { createSolver: () => solver, waitForMountObservation: async () => {} },
  })

  await drainImmediateWork(app.ready())
  await vi.advanceTimersByTimeAsync(10)
  await request('/api/web/rigs/fixture')
}

interface InFlight {
  readonly reply: Promise<LightMyRequestResponse>
  readonly answered: () => boolean
}

function send(options: InjectOptions | string): InFlight {
  let answered = false

  const reply = app.inject(options).finally(() => {
    answered = true
  })

  return { reply, answered: () => answered }
}

async function drainImmediateWork<T>(pending: Promise<T>): Promise<T> {
  let settled = false

  pending.then(
    () => (settled = true),
    () => (settled = true),
  )

  for (let turn = 0; turn < 200 && !settled; turn++) await vi.advanceTimersByTimeAsync(0)

  expect(settled, 'answered without waiting on the clock').toBe(true)

  return pending
}

function request(options: InjectOptions | string) {
  return drainImmediateWork(app.inject(options))
}

function post(url: string, payload: InjectOptions['payload'] = {}): InjectOptions {
  return { method: 'POST', url, payload }
}

function postNoBody(url: string): InjectOptions {
  return { method: 'POST', url }
}

function recoverPath(device: 'camera' | 'mount') {
  return `/api/rigs/fixture/devices/${encodeURIComponent(`cria:fixture:${device}`)}/recover`
}

function mountOf(detail: LightMyRequestResponse) {
  return detail.json().devices.find((device: { readonly id: string }) => device.id === mountView)
}

function sent(...routes: ReadonlyArray<Route>) {
  return cria.received.flatMap(received => (received.route !== undefined && routes.includes(received.route) ? [received.route] : []))
}

const submission = z.object({ deviceId: z.string(), kind: z.string() })

function submitted() {
  return cria.received.flatMap(received => {
    if (received.route !== 'submit' || received.body === undefined) return []
    const { deviceId, kind } = submission.parse(JSON.parse(received.body))

    return [`${deviceId} ${kind}`]
  })
}

const ledgerSchema = z.object({ operations: z.array(z.object({ id: z.string(), kind: z.string(), state: z.string() })) })

async function ledger() {
  const response = await cria.fetch(`${cria.origin}/v2/state`)

  return ledgerSchema.parse(await response.json()).operations
}

async function running(kind: string): Promise<string> {
  const operation = (await ledger()).find(candidate => candidate.kind === kind && candidate.state === 'running')

  return operation?.id ?? never()
}

describe('a slew through framing', () => {
  it('finds a slew whose admission reply was lost by lookup, POSTs it once, and checks the frame', async () => {
    await openAndInspectRig()
    cria.durationMs['mount-slew'] = 5_000
    cria.dropReply('submit')

    const started = await request(post('/api/rigs/fixture/framing/start', slewToNgc7000))

    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ active: true, phase: 'slewing' })

    await vi.advanceTimersByTimeAsync(10_000)

    expect((await request('/api/web/rigs/fixture/framing')).json()).toMatchObject({ active: false, phase: 'checked', error: null })
    expect(submitted()).toEqual(['mount mount-slew', 'camera capture'])
    expect(sent('submit', 'lookup', 'cancel')).toEqual(['submit', 'lookup', 'submit'])
  })

  it('shows the unknown hold while Cria has not shown the slew, then follows and cancels it once Cria admits it', async () => {
    await openAndInspectRig()
    cria.durationMs['mount-slew'] = 30_000
    cria.delay('submit', 4_500)
    await request(post('/api/rigs/fixture/framing/start', slewToNgc7000))
    await vi.advanceTimersByTimeAsync(2_500)

    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({
      enabled: false,
      unavailableReason: expect.stringContaining('Cria has not shown whether it admitted mount-slew'),
    })

    const stopping = send(postNoBody('/api/rigs/fixture/framing/stop'))

    await vi.advanceTimersByTimeAsync(2_400)

    expect(stopping.answered()).toBe(false)
    expect(sent('submit', 'lookup', 'cancel')).toEqual(['submit', 'lookup', 'lookup', 'lookup'])

    await vi.advanceTimersByTimeAsync(1_000)

    expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({ active: false, phase: 'stopped', error: null })
    expect(sent('submit', 'lookup', 'cancel')).toEqual(['submit', 'lookup', 'lookup', 'lookup', 'lookup', 'cancel'])
  })

  it.each([
    { stop: true, ending: { phase: 'stopped', error: null } },
    { stop: false, ending: { phase: 'failed', error: expect.stringContaining('Cria never admitted mount-slew; recovery fenced the request') } },
  ])('fences a slew Cria never showed through the recover route, and framing ends $ending.phase', async ({ stop, ending }) => {
    await openAndInspectRig()
    const binding = cria.bindingOf('mount')

    cria.delay('submit', 10_000)
    await request(post('/api/rigs/fixture/framing/start', slewToNgc7000))
    await vi.advanceTimersByTimeAsync(2_500)
    const stopping = stop ? send(postNoBody('/api/rigs/fixture/framing/stop')) : undefined
    const recovering = send(post(recoverPath('mount'), { externalRecoveryConfirmed: true, note: 'Checked the mount at the pier' }))

    await vi.advanceTimersByTimeAsync(500)
    const recovered = await drainImmediateWork(recovering.reply)

    expect(recovered.statusCode).toBe(200)
    expect(recovered.json()).toEqual({ outcome: 'confirmed', found: 'Cria never admitted mount-slew' })
    expect(cria.bindingOf('mount')).not.toBe(binding)

    if (stopping) expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({ active: false, ...ending })
    expect((await request('/api/web/rigs/fixture/framing')).json()).toMatchObject({ active: false, ...ending })
    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({ enabled: true, unavailableReason: null })

    await vi.advanceTimersByTimeAsync(8_000)

    expect(await ledger()).toEqual([])
    expect(sent('submit')).toEqual(['submit'])
  })

  it('stops the slew a recovery finds open through the recover route, then recovers again', async () => {
    await openAndInspectRig()
    cria.durationMs['mount-slew'] = 60_000
    cria.stopMs = 1_000
    cria.delay('submit', 4_500)
    await request(post('/api/rigs/fixture/framing/start', slewToNgc7000))
    await vi.advanceTimersByTimeAsync(4_600)
    const recovering = send(post(recoverPath('mount'), { externalRecoveryConfirmed: true, note: 'Checked the mount at the pier' }))

    await vi.advanceTimersByTimeAsync(2_000)

    expect((await drainImmediateWork(recovering.reply)).json()).toEqual({ outcome: 'confirmed', found: 'Cria had run mount-slew: stopped' })
    expect((await request('/api/web/rigs/fixture/framing')).json()).toMatchObject({ active: false, phase: 'failed' })
    expect(sent('recover', 'cancel')).toEqual(['recover', 'cancel', 'recover'])
    expect(sent('submit')).toEqual(['submit'])
  })

  it('sends a framing Stop again until Cria acknowledges it, and the slew still once', async () => {
    await openAndInspectRig()
    cria.durationMs['mount-slew'] = 60_000
    cria.stopMs = 5_000
    await request(post('/api/rigs/fixture/framing/start', slewToNgc7000))
    await vi.advanceTimersByTimeAsync(100)
    cria.dropReply('cancel')
    const stopping = send(postNoBody('/api/rigs/fixture/framing/stop'))

    await vi.advanceTimersByTimeAsync(10_000)

    expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({ active: false, phase: 'stopped', error: null })
    expect(sent('submit', 'cancel')).toEqual(['submit', 'cancel', 'cancel'])
  })

  it.each([2_000, 19_000])('answers a framing Stop once the mount stands still %d ms later, with no Vela deadline', async stopMs => {
    await openAndInspectRig()
    cria.durationMs['mount-slew'] = 60_000
    cria.stopMs = stopMs
    await request(post('/api/rigs/fixture/framing/start', slewToNgc7000))
    await vi.advanceTimersByTimeAsync(100)
    const stopping = send(postNoBody('/api/rigs/fixture/framing/stop'))

    await vi.advanceTimersByTimeAsync(stopMs - 100)

    expect(stopping.answered()).toBe(false)

    await vi.advanceTimersByTimeAsync(2_000)

    expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({ active: false, phase: 'stopped', error: null })
    expect(sent('submit', 'cancel', 'lookup')).toEqual(['submit', 'cancel'])
  })
})

describe('exposures through capture', () => {
  it('keeps the frame of an exposure that finished while its Stop was pending', async () => {
    await openAndInspectRig()
    cria.stopMs = 5_000
    await request(post('/api/rigs/fixture/capture/start', { exposureSeconds: 2 }))
    await vi.advanceTimersByTimeAsync(1_000)
    const stopping = send(postNoBody('/api/rigs/fixture/capture/stop'))

    await vi.advanceTimersByTimeAsync(1_500)

    expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({
      active: false,
      phase: 'complete',
      completedCount: 1,
      lostFrameCount: 0,
      latestImage: { width: 4, height: 3, exposureSeconds: 2, cameraName: 'Fake CCD' },
    })
    expect(sent('submit', 'cancel', 'image')).toEqual(['submit', 'cancel', 'image'])
  })

  it('counts an image Cria dropped as one lost frame and exposes no second time', async () => {
    await openAndInspectRig()
    cria.delay('image', 500)
    await request(post('/api/rigs/fixture/capture/start', { exposureSeconds: 1 }))
    await vi.advanceTimersByTimeAsync(1_400)
    const imageId = cria.received.find(received => received.route === 'image')?.path.split('/')[3]

    cria.dropImage(imageId ?? never())
    await vi.advanceTimersByTimeAsync(5_000)

    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({
      active: false,
      phase: 'failed',
      completedCount: 0,
      lostFrameCount: 1,
      error: expect.stringContaining(`Cria dropped image ${imageId}`),
    })
    expect(sent('submit', 'image')).toEqual(['submit', 'image'])
  })

  it('ends an exposure Cria restarted under as failed, holds the camera, sends nothing again, and recovers it', async () => {
    await openAndInspectRig()
    await request(post('/api/rigs/fixture/capture/start', { exposureSeconds: 10 }))
    await vi.advanceTimersByTimeAsync(2_000)
    cria.restart()
    await vi.advanceTimersByTimeAsync(2_000)

    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({
      active: false,
      phase: 'failed',
      error: expect.stringContaining('Cria restarted while capture was running'),
      enabled: false,
      unavailableReason: expect.stringContaining('Vela lost track of capture'),
    })

    await vi.advanceTimersByTimeAsync(20_000)

    expect(sent('submit', 'lookup', 'cancel', 'image')).toEqual(['submit'])

    const recovered = await request(post(recoverPath('camera'), { externalRecoveryConfirmed: true, note: 'Checked the camera is idle' }))

    expect(recovered.statusCode).toBe(200)
    expect(recovered.json()).toEqual({ outcome: 'confirmed', found: 'Cria restarted, so what capture did is unknown' })
    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({ enabled: true, unavailableReason: null })
    expect(sent('submit', 'recover')).toEqual(['submit'])
  })
})

describe('the session through the rig view', () => {
  it('starts interrupted when Cria is unreachable, refuses an exposure, and reconnects quietly', async () => {
    cria.reachable = false
    await openAndInspectRig()
    await vi.advanceTimersByTimeAsync(5_000)
    const interrupted = { state: 'interrupted', commandReady: false }

    expect((await request('/api/web/rigs/fixture')).json()).toMatchObject({
      devices: [
        { id: 'fixture-cria:fixture:camera', observation: interrupted },
        { id: mountView, observation: interrupted },
        { id: 'fixture-cria:fixture:focuser', observation: interrupted },
      ],
    })
    expect((await request(post('/api/rigs/fixture/capture/start', { exposureSeconds: 1 }))).statusCode).toBe(409)

    cria.reachable = true
    await vi.advanceTimersByTimeAsync(1_000)
    const ready = { connection: 'connected', observation: { commandReady: true } }

    expect((await request('/api/web/rigs/fixture')).json()).toMatchObject({
      devices: [
        { id: 'fixture-cria:fixture:camera', ...ready },
        { id: mountView, ...ready },
        { id: 'fixture-cria:fixture:focuser', ...ready },
      ],
    })
    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({ enabled: true, unavailableReason: null })
    expect(sent('submit')).toEqual([])
  })
})

describe('a halt through autofocus', () => {
  it('halts the focuser when autofocus stops, sends a halt whose reply was lost again unchanged, and restores the start', async () => {
    await openAndInspectRig()
    cria.durationMs['focuser-move'] = 3_000

    const started = await request(post('/api/rigs/fixture/autofocus/start', { exposureSeconds: 1 }))

    expect(started.json()).toMatchObject({ active: true, phase: 'walking', startPosition: 20_000 })

    await vi.advanceTimersByTimeAsync(1_000)
    cria.dropReply('submit')
    const stopping = send(postNoBody('/api/rigs/fixture/autofocus/stop'))

    await vi.advanceTimersByTimeAsync(9_000)

    expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({
      active: false,
      phase: 'stopped',
      restoredStart: true,
      currentPosition: 20_000,
      error: null,
    })
    expect(submitted()).toEqual(['focuser focuser-move', 'focuser focuser-halt', 'focuser focuser-halt', 'focuser focuser-move', 'focuser focuser-move'])

    const [halt, again] = cria.received.flatMap(received => (received.route === 'submit' && received.body?.includes('focuser-halt') ? [received.body] : []))

    expect(again).toBe(halt)
    expect(sent('cancel')).toEqual(['cancel'])
  })
})

const held = 'The mount did not report standing still'

const uncertainMountWork = [
  {
    through: 'a framing slew',
    kind: 'mount-slew',
    async begin() {
      return send(post('/api/rigs/fixture/framing/start', slewToNgc7000))
    },
  },
  {
    through: 'Tracking off',
    kind: 'mount-tracking',
    async begin() {
      const { serverInstanceId } = mountOf(await request('/api/web/rigs/fixture')).mountControl

      return send(post('/api/rigs/fixture/mount', { deviceId: mountView, requestId: randomUUID(), serverInstanceId, action: 'tracking-off' }))
    },
  },
] as const

describe("a mount hold through today's lease routes", () => {
  it.each(uncertainMountWork)('blocks autofocus, Forget and connection with the hold after $through ends uncertain, until recovery clears it', async ({ kind, begin }) => {
    await openAndInspectRig()
    cria.durationMs[kind] = 60_000
    const work = await begin()

    await vi.advanceTimersByTimeAsync(300)
    cria.settle(await running(kind), { kind: 'uncertain', reason: 'stop-not-confirmed', message: held })
    await vi.advanceTimersByTimeAsync(300)

    expect((await drainImmediateWork(work.reply)).statusCode).toBe(200)

    const reason = expect.stringContaining(held)

    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({ enabled: false, unavailableReason: reason })
    expect((await request('/api/web/rigs/fixture/autofocus')).json()).toMatchObject({ enabled: false, unavailableReason: reason })
    const heldDetail = await request('/api/web/rigs/fixture')

    expect(mountOf(heldDetail)).toMatchObject({ observation: { commandReady: false, message: reason, hold: { deviceId: 'cria:fixture:mount', reason } } })
    expect(heldDetail.json().devices.filter((device: { readonly observation?: { readonly hold?: unknown } }) => device.observation?.hold !== undefined)).toHaveLength(1)
    expect((await request(post('/api/rigs/fixture/autofocus/start', { exposureSeconds: 1 }))).statusCode).toBe(409)

    const forget = await request({ method: 'DELETE', url: '/api/rigs/fixture' })
    const connect = await request(post('/api/rigs/fixture/connections'))

    expect([forget.statusCode, connect.statusCode]).toEqual([409, 409])
    expect([forget.json(), connect.json()]).toMatchObject([{ error: 'rig-operation-in-progress' }, { error: 'rig-operation-in-progress' }])

    await vi.advanceTimersByTimeAsync(2_000)

    expect(submitted()).toEqual([`mount ${kind}`])

    const binding = cria.bindingOf('mount')
    const recovering = send(post(recoverPath('mount'), { externalRecoveryConfirmed: true, note: 'Checked the mount at the pier' }))

    await vi.advanceTimersByTimeAsync(500)
    const recovered = await drainImmediateWork(recovering.reply)

    expect(recovered.statusCode).toBe(200)
    expect(recovered.json()).toEqual({ outcome: 'confirmed', found: 'Cria recovered ZWO AM5' })
    expect(cria.received.flatMap(received => (received.route === 'recover' ? [[received.path, JSON.parse(received.body ?? never())]] : []))).toEqual([
      ['/v2/devices/mount/recover', { instanceId: cria.instanceId, bindingId: binding, externalRecoveryConfirmed: true, note: 'Checked the mount at the pier' }],
    ])
    expect(mountOf(await request('/api/web/rigs/fixture')).observation).not.toHaveProperty('hold')
    expect((await request('/api/web/rigs/fixture/capture')).json()).toMatchObject({ enabled: true, unavailableReason: null })
    expect((await request('/api/web/rigs/fixture/autofocus')).json()).toMatchObject({ enabled: true, unavailableReason: null })
    expect((await request(post('/api/rigs/fixture/connections'))).json()).toMatchObject({ outcome: 'complete', command: 'not-needed' })

    const started = await request(post('/api/rigs/fixture/autofocus/start', { exposureSeconds: 1 }))

    expect(started.statusCode).toBe(200)
    expect(started.json()).toMatchObject({ active: true, phase: 'walking', startPosition: 20_000 })

    await vi.advanceTimersByTimeAsync(1_000)

    expect(submitted()).toEqual([`mount ${kind}`, 'focuser focuser-move', 'camera capture'])

    const stopping = send(postNoBody('/api/rigs/fixture/autofocus/stop'))

    await vi.advanceTimersByTimeAsync(2_000)

    expect((await drainImmediateWork(stopping.reply)).json()).toMatchObject({ active: false, phase: 'stopped' })
    expect((await request({ method: 'DELETE', url: '/api/rigs/fixture' })).statusCode).toBe(204)
  })
})

function never(): never {
  throw new Error('The fake did not produce what this test set up')
}
