import { mkdtemp, open, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InjectOptions } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'
import { buildApp } from '../src/app.js'
import { frameRecordsOn, type FrameRecord } from '../src/capture/frame-records.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { registerConfiguredCriaRigs, type CriaRigConfiguration } from '../src/equipment/config.js'
import * as statistics from '../src/imaging/statistics.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { openFileSavedImageStore } from '../src/saved-images/store.js'
import { openRunLog, type RunLog, type RunLogOptions } from '../src/run-log/run-log.js'
import { decodeLine } from '@vela/rig-events'

let cria: FakeCria

let app: ReturnType<typeof buildApp>

let directory: string

let records: FrameRecord[]

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 17, 3) })
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('This test has no network')))
  cria = new FakeCria()
  records = []
  directory = await mkdtemp(join(tmpdir(), 'vela-frame-records-'))
})

afterEach(async () => {
  await app.close()
  cria.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await rm(directory, { recursive: true, force: true })
})

async function openRig(savedImages = openFileSavedImageStore(join(directory, 'saved-images')), runLog?: RunLog) {
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
    savedImages: await savedImages,
    frameRecords: runLog ? frameRecordsOn(runLog) : { append: record => void records.push(record) },
    ...(runLog && { runLog }),
  })

  await app.ready()
  await vi.advanceTimersByTimeAsync(10)
  await request('/api/web/rigs/fixture')
}

async function request(options: InjectOptions | string) {
  const answer = app.inject(options)

  await vi.advanceTimersByTimeAsync(0)

  return answer
}

const startCapture = (payload: { exposureSeconds: number; repeat?: boolean; saveFrames?: boolean }) =>
  request({ method: 'POST', url: '/api/rigs/fixture/capture/start', payload })

const stopCapture = () =>
  request({ method: 'POST', url: '/api/rigs/fixture/capture/stop' })

const ledgerSchema = z.object({
  operations: z.array(
    z.object({
      id: z.string(),
      requestId: z.string(),
      state: z.string(),
      outcome: z
        .object({ value: z.object({ image: z.object({ id: z.string() }).nullable() }).optional() })
        .optional(),
    }),
  ),
})

async function ledger() {
  const response = await cria.fetch(`${cria.origin}/v2/state`)

  return ledgerSchema.parse(await response.json()).operations
}

function submittedRequestIds() {
  return cria.received.flatMap(received =>
    received.route === 'submit' && received.body !== undefined
      ? [z.object({ requestId: z.string() }).parse(JSON.parse(received.body)).requestId]
      : [],
  )
}

describe('one frame record for every capture attempt', () => {
  it('records a saved frame with the ids Cria gave it, and the saved image keeps them', async () => {
    await openRig()
    await startCapture({ exposureSeconds: 1, saveFrames: true })
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(records).toHaveLength(1))

    const [operation] = await ledger()
    const [requestId] = submittedRequestIds()
    const imageId = operation!.outcome!.value!.image!.id

    expect(records).toEqual([
      {
        rigId: 'fixture',
        runId: expect.any(String),
        attempt: 1,
        startedAt: '2026-10-17T03:00:00.010Z',
        settledAt: expect.any(String),
        exposureSeconds: 1,
        frameType: 'light',
        subject: null,
        outcome: 'saved',
        message: null,
        provenance: { requestId, operationId: operation!.id, imageId },
        image: {
          id: expect.any(String),
          capturedAt: expect.any(String),
          capturedAtSource: 'camera',
          receivedAt: expect.any(String),
          width: 4,
          height: 3,
        },
        fits: { path: expect.stringMatching(/original\.fits$/), bytes: expect.any(Number) },
        statistics: {
          algorithm: { version: 3 },
          detectedStars: expect.any(Number),
          medianHfrPixels: expect.toBeOneOf([null, expect.any(Number)]),
          detections: expect.any(Number),
          measured: expect.any(Number),
          strong: expect.any(Number),
          rejected: expect.objectContaining({ blended: expect.any(Number), elongated: expect.any(Number) }),
          sky: expect.any(Number),
          noise: expect.any(Number),
          axisRatio: expect.toBeOneOf([null, expect.any(Number)]),
        },
      },
    ])

    const reopened = await openFileSavedImageStore(join(directory, 'saved-images'))

    expect((await reopened.get('fixture', records[0]!.image!.id))?.provenance).toEqual({
      requestId,
      operationId: operation!.id,
      imageId,
    })
  })

  it('records a frame that is not saved as unsaved', async () => {
    await openRig()
    await startCapture({ exposureSeconds: 1 })
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(records).toHaveLength(1))

    expect(records[0]).toMatchObject({ outcome: 'unsaved', provenance: { imageId: expect.any(String) } })
  })

  it('records the ids of an image Cria dropped as one lost frame, then the stopped frame after it', async () => {
    await openRig()
    cria.delay('image', 500)
    await startCapture({ exposureSeconds: 1, repeat: true })
    await vi.advanceTimersByTimeAsync(1_400)

    const dropped = cria.received.find(received => received.route === 'image')?.path.split('/')[3]

    cria.dropImage(dropped!)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(500)
    const stopping = stopCapture()

    await vi.advanceTimersByTimeAsync(100)
    await stopping

    const [first, second] = await ledger()
    const [firstRequest, secondRequest] = submittedRequestIds()

    expect(records.map(({ attempt, outcome }) => ({ attempt, outcome }))).toEqual([
      { attempt: 1, outcome: 'lost' },
      { attempt: 2, outcome: 'stopped' },
    ])
    expect(records[0]).toMatchObject({
      message: `Cria dropped image ${dropped} before Vela fetched it`,
      provenance: { requestId: firstRequest, operationId: first!.id, imageId: dropped },
      image: null,
      statistics: null,
    })
    expect(records[1]).toMatchObject({
      message: null,
      provenance: { requestId: secondRequest, operationId: second!.id, imageId: null },
    })
    expect(records[1]!.runId).toBe(records[0]!.runId)
  })

  it('records a request Cria refused with only its request ID', async () => {
    await openRig()
    cria.restart()
    await startCapture({ exposureSeconds: 1 })
    await vi.advanceTimersByTimeAsync(100)
    await vi.waitFor(() => expect(records).toHaveLength(1))

    expect(records[0]).toMatchObject({
      outcome: 'failed',
      message: expect.stringContaining('Cria restarted'),
      provenance: { requestId: submittedRequestIds()[0], operationId: null, imageId: null },
      image: null,
    })
  })

  it('records an exposure Cria restarted under as uncertain, with its request and operation IDs', async () => {
    await openRig()
    await startCapture({ exposureSeconds: 10 })
    await vi.advanceTimersByTimeAsync(2_000)
    const [operation] = await ledger()

    cria.restart()
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(records).toHaveLength(1))

    expect(records[0]).toMatchObject({
      outcome: 'uncertain',
      message: expect.stringContaining('Cria restarted while capture was running'),
      provenance: { requestId: submittedRequestIds()[0], operationId: operation!.id, imageId: null },
    })
  })

  it('records a frame whose star measurement failed with its image and no statistics', async () => {
    vi.spyOn(statistics, 'measureStars').mockRejectedValue(new Error('measurement failed'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await openRig()
    await startCapture({ exposureSeconds: 1, saveFrames: true })
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(records).toHaveLength(1))

    expect(records[0]).toMatchObject({
      outcome: 'saved',
      image: { id: expect.any(String) },
      statistics: null,
    })
  })

  it('records a save failure with the ids the frame had', async () => {
    const savedImages = await openFileSavedImageStore(join(directory, 'saved-images'))

    vi.spyOn(savedImages, 'save').mockRejectedValue(new Error('disk full'))
    await openRig(Promise.resolve(savedImages))
    await startCapture({ exposureSeconds: 1, saveFrames: true })
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(records).toHaveLength(1))

    expect(records[0]).toMatchObject({
      outcome: 'save-failed',
      message: 'disk full',
      provenance: { operationId: expect.any(String), imageId: expect.any(String) },
      image: { id: expect.any(String) },
    })
  })
})

describe('frame events in the run log', () => {
  const logs: RunLog[] = []

  afterEach(async () => {
    await Promise.all(logs.splice(0).map(log => log.close()))
  })

  function openLog(options: Partial<RunLogOptions> = {}) {
    const log = openRunLog({ directory: join(directory, 'run-log'), retry: { firstMs: 5, lastMs: 20 }, onProblem: () => {}, ...options })

    logs.push(log)

    return log
  }

  async function frameEvents() {
    const events = []

    for (const name of await readdir(join(directory, 'run-log')).catch(() => [])) {
      for (const line of (await readFile(join(directory, 'run-log', name), 'utf8')).split('\n')) {
        const decoded = line === '' ? undefined : decodeLine(line)

        if (decoded?.ok && decoded.event.kind === 'frame') events.push(decoded.event)
      }
    }

    return events
  }

  const completed = async () => z.object({ completedCount: z.number() }).parse((await request('/api/web/rigs/fixture/capture')).json()).completedCount

  it('files a saved frame with the path of its FITS, and a lost frame with why it was lost', async () => {
    const log = openLog()

    await openRig(undefined, log)
    cria.delay('image', 500)
    await startCapture({ exposureSeconds: 1, repeat: true, saveFrames: true })
    await vi.advanceTimersByTimeAsync(1_400)
    cria.dropImage(cria.received.find(received => received.route === 'image')!.path.split('/')[3]!)
    await vi.advanceTimersByTimeAsync(2_000)
    const stopping = stopCapture()

    await vi.advanceTimersByTimeAsync(2_000)
    await stopping
    await log.close()

    const [lost, ...rest] = await frameEvents()
    const saved = rest.find(event => event.body.outcome === 'saved')

    expect(lost?.body).toMatchObject({ outcome: 'lost', message: expect.stringContaining('Cria dropped image'), image: null, origin: 'capture-run' })
    expect(lost?.rig).toBe('fixture')
    expect(saved?.body.image?.ref?.uri).toMatch(/^file:\/\/\/.*original\.fits$/)
    expect(saved?.body.image?.ref?.bytes).toBeGreaterThan(0)
  })

  it('keeps capturing through a full disk, shows the error on /api/health, and writes the frames once the disk recovers', async () => {
    const state = { full: true }
    const log = openLog({ openFile: (path, flags, mode) => (state.full ? open('/dev/full', 'a') : open(path, flags, mode)) })

    await openRig(undefined, log)
    await startCapture({ exposureSeconds: 1, repeat: true })
    await vi.advanceTimersByTimeAsync(5_000)

    for (let step = 0; step < 20 && (await completed()) < 2; step++) await vi.advanceTimersByTimeAsync(500)
    expect(await completed()).toBeGreaterThanOrEqual(2)

    const health = z.object({ status: z.string(), runLog: z.object({ state: z.string(), lastError: z.object({ message: z.string() }).nullable() }) }).parse((await request('/api/health')).json())

    expect(health).toMatchObject({ status: 'ok', runLog: { state: 'retrying', lastError: { message: expect.stringContaining('ENOSPC') } } })

    state.full = false

    for (let step = 0; step < 50 && log.health().state !== 'ok'; step++) await vi.advanceTimersByTimeAsync(100)
    expect(log.health().state).toBe('ok')
    const stopping = stopCapture()

    await vi.advanceTimersByTimeAsync(2_000)
    await stopping
    await log.close()

    expect((await frameEvents()).length).toBeGreaterThanOrEqual(2)
  })
})
