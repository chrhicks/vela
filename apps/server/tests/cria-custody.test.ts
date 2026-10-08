import { mkdtemp, open, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CriaClient, CriaUncertainError } from '@vela/cria'
import { ServiceFixture, failure, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createCriaCustody, expectedAcquisition } from '../src/cria/custody.js'
import {
  createMemoryAcquisitionArchive,
  nodeArchiveFileSystem,
  openAcquisitionArchive,
  type AcquisitionArchive,
} from '../src/acquisitions/archive.js'

function setup(service: ServiceFixture, archive: AcquisitionArchive = createMemoryAcquisitionArchive(), fetch = service.fetch) {
  const bindings = service.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName, providerDeviceId: id }))

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    storeId: service.state.storeId,
    devices: bindings.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    fetch,
    pollIntervalMs: 1,
    operationTimeoutMs: 1000,
    imageRetryMs: 30,
  })

  onTestFinished(() => client.close())
  const custody = createCriaCustody(client, archive, service.state.storeId)

  return { client, custody, archive, equipment: createCriaEquipment(client, bindings, custody, 'rig-1') }
}

const request = { cameraId: 'camera', exposureSeconds: 0.001, purpose: 'autofocus' } as const

const isAdmission = (input: RequestInfo | URL, init?: RequestInit) =>
  new URL(String(input)).pathname === '/v2/operations' && init?.method === 'POST'

/** Cria processes the request and completes the exposure, but its response waits on a gate. */
function delayedAdmission(service: ServiceFixture) {
  let release = () => {}

  let processed = () => {}

  const gate = new Promise<void>(resolve => { release = resolve })
  const reached = new Promise<void>(resolve => { processed = resolve })

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await service.fetch(input, init)

    if (isAdmission(input, init)) {
      processed()
      await gate
    }

    return response
  }

  return { fetch, release, reached }
}

async function manifest(directory: string, service: ServiceFixture) {
  const record = [...service.custody.values()][0]!

  return JSON.parse(await readFile(join(directory, record.storeId, record.id, 'context.json'), 'utf8'))
}

describe('acquisition custody through the Cria adapter', () => {
  it('archives the exact original with recorded intent before the consumer receives pixels', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const { equipment } = setup(service, await openAcquisitionArchive(directory))
    const frame = await equipment.acquisition.capture(request)
    const record = [...service.custody.values()][0]!
    const stored = await manifest(directory, service)

    expect(frame.pixels.length).toBe(6)
    expect(record.state).toBe('archived')
    expect(service.receipts).toHaveLength(1)
    expect(stored.intent).toMatchObject({ purpose: 'autofocus', rigId: 'rig-1', deviceId: 'camera', requestId: record.requestId })
    expect(stored.preservation.by).toBe('acquisition')
    expect(stored.cria.context.requested).toEqual(record.context.requested)
    expect(service.paths.some(path => path.startsWith('DELETE'))).toBe(false)
  })

  it('leaves a result to its acquisition when recovery runs before the admission response arrives', async () => {
    // Promoted from the independent review: recovery used to release the active capture's original.
    const service = new ServiceFixture()

    service.releaseOnReceipt = true
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const delayed = delayedAdmission(service)
    const { equipment, custody } = setup(service, await openAcquisitionArchive(directory), delayed.fetch)
    const capturing = equipment.acquisition.capture(request)

    await delayed.reached
    expect([...service.custody.values()][0]!.state).toBe('retained')
    expect(await custody.recover()).toEqual({ acknowledged: 0, preserved: 0, problems: [] })
    delayed.release()

    expect((await capturing).pixels.length).toBe(6)
    const record = [...service.custody.values()][0]!
    const stored = await manifest(directory, service)

    expect(record.state).toBe('released')
    expect(new Set(service.receipts)).toEqual(new Set([record.receipt!.receiptId]))
    expect(stored.intent.purpose).toBe('autofocus')
    expect(stored.preservation.by).toBe('acquisition')
    expect(service.posts).toHaveLength(1)
  })

  it('reconciles a lost admission response to the same request and archives its result once', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    let lost = false

    const { equipment, custody } = setup(service, await openAcquisitionArchive(directory), async (input, init) => {
      const response = await service.fetch(input, init)

      if (!lost && isAdmission(input, init)) {
        lost = true
        // Recovery during the unresolved admission must not take the result either.
        expect((await custody.recover()).preserved).toBe(0)
        throw new TypeError('Admission response lost')
      }

      return response
    })

    expect((await equipment.acquisition.capture(request)).pixels.length).toBe(6)
    expect(service.posts).toHaveLength(1)
    expect(service.receipts).toHaveLength(1)
    expect((await manifest(directory, service)).intent.purpose).toBe('autofocus')
  })

  it('refuses to send a request whose intent cannot be recorded', async () => {
    const service = new ServiceFixture()
    const working = createMemoryAcquisitionArchive()
    const { equipment } = setup(service, { ...working, recordIntent: async () => { throw new Error('Archive disk unavailable') } })

    await expect(equipment.acquisition.capture(request)).rejects.toThrow('Archive disk unavailable')
    expect(service.posts).toHaveLength(0)
  })

  it('returns pixels when preservation fails and later archives the same original with its purpose', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const working = await openAcquisitionArchive(directory)
    const broken: AcquisitionArchive = { ...working, preserve: async () => { throw new Error('Archive disk unavailable') } }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = setup(service, broken)

    expect((await failing.equipment.acquisition.capture(request)).pixels.length).toBe(6)
    expect(error).toHaveBeenCalled()
    expect([...service.custody.values()][0]!.state).toBe('retained')

    expect(await setup(service, working).custody.recover()).toMatchObject({ preserved: 1, problems: [] })
    const stored = await manifest(directory, service)

    expect([...service.custody.values()][0]!.state).toBe('archived')
    expect(stored.intent.purpose).toBe('autofocus')
    expect(stored.preservation.by).toBe('recovery')
    expect(service.posts).toHaveLength(1)
    error.mockRestore()
  })

  it('resends the same verified receipt after a lost acknowledgement response', async () => {
    const service = new ServiceFixture()
    const archive = createMemoryAcquisitionArchive()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let dropped = false

    const lossy = setup(service, archive, async (input, init) => {
      const response = await service.fetch(input, init)

      if (!dropped && String(input).endsWith('/archive-receipt')) {
        dropped = true
        throw new TypeError('Response lost')
      }

      return response
    })

    await lossy.equipment.acquisition.capture(request)
    const record = [...service.custody.values()][0]!

    expect(record.state).toBe('archived')
    expect((await archive.unacknowledged(service.state.storeId)).receipts).toHaveLength(1)
    expect(await setup(service, archive).custody.recover()).toMatchObject({ acknowledged: 1, problems: [] })
    expect(new Set(service.receipts)).toEqual(new Set([record.receipt!.receiptId]))
    expect((await archive.unacknowledged(service.state.storeId)).receipts).toEqual([])
    error.mockRestore()
  })

  it('archives a verified result of an uncertain operation with its purpose, leaving the interlock', async () => {
    const service = new ServiceFixture()

    service.completeImmediately = false
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const { equipment, custody, client } = setup(service, await openAcquisitionArchive(directory))
    const capturing = equipment.acquisition.capture(request)

    await vi.waitFor(() => expect(service.last).not.toBeNull())
    const operation = service.finish('uncertain')

    await expect(capturing).rejects.toBeInstanceOf(CriaUncertainError)
    service.retain(operation)
    expect(await custody.recover()).toMatchObject({ preserved: 1, problems: [] })
    expect(service.custody.get(operation.reservedImageId!)?.state).toBe('archived')
    expect((await manifest(directory, service)).intent.purpose).toBe('autofocus')
    expect(client.commandBlockReasonFor('camera')).not.toBeNull()
    expect(service.posts).toHaveLength(1)
  })

  it('keeps recorded intent across a Vela restart before the admission response arrived', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const delayed = delayedAdmission(service)
    const before = setup(service, await openAcquisitionArchive(directory), delayed.fetch)

    void before.equipment.acquisition.capture(request).catch(() => {})
    await delayed.reached
    // The process ends here: its in-memory ownership is gone, the durable intent is not.
    await before.client.close()

    const after = setup(service, await openAcquisitionArchive(directory))

    expect(await after.custody.recover()).toMatchObject({ preserved: 1, problems: [] })
    const stored = await manifest(directory, service)

    expect(stored.intent).toMatchObject({ purpose: 'autofocus', rigId: 'rig-1' })
    expect(stored.preservation.by).toBe('recovery')
    expect(service.posts).toHaveLength(1)
    delayed.release()
  })

  it('recovers every retained original across several pages', async () => {
    const service = new ServiceFixture()
    const working = createMemoryAcquisitionArchive()
    const broken: AcquisitionArchive = { ...working, preserve: async () => { throw new Error('Archive disk unavailable') } }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = setup(service, broken)

    for (let index = 0; index < 120; index++) await failing.equipment.acquisition.capture(request)
    expect([...service.custody.values()].filter(record => record.state === 'retained')).toHaveLength(120)

    expect(await setup(service, working).custody.recover()).toMatchObject({ preserved: 120, problems: [] })
    expect([...service.custody.values()].every(record => record.state === 'archived')).toBe(true)
    expect(service.posts).toHaveLength(120)
    error.mockRestore()
  })

  it('continues past a short page that Cria returns while records change state', async () => {
    const service = new ServiceFixture()
    const working = createMemoryAcquisitionArchive()
    const broken: AcquisitionArchive = { ...working, preserve: async () => { throw new Error('Archive disk unavailable') } }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = setup(service, broken)

    for (let index = 0; index < 60; index++) await failing.equipment.acquisition.capture(request)
    let shortened = false

    // The first page comes back one record short, as when a record is archived mid-scan.
    const { custody } = setup(service, working, async (input, init) => {
      const response = await service.fetch(input, init)

      if (shortened || new URL(String(input)).pathname !== '/v2/images') return response
      shortened = true
      const page = await response.json()

      return Response.json({ ...page, images: page.images.slice(1) })
    })

    const report = await custody.recover()

    expect(report).toMatchObject({ preserved: 59, problems: [] })
    expect([...service.custody.values()].filter(record => record.state === 'retained')).toHaveLength(1)
    error.mockRestore()
  })

  it('ends a cycle at the first archive write failure instead of re-downloading every original', async () => {
    const service = new ServiceFixture()
    const working = createMemoryAcquisitionArchive()
    const broken: AcquisitionArchive = { ...working, preserve: async () => { throw new Error('No space left on device') } }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = setup(service, broken)

    for (let index = 0; index < 5; index++) await failing.equipment.acquisition.capture(request)

    const before = service.paths.filter(path => path.endsWith('/original')).length
    const report = await setup(service, broken).custody.recover()

    expect(service.paths.filter(path => path.endsWith('/original')).length - before).toBe(1)
    expect(report.preserved).toBe(0)
    expect(report.problems.at(-1)).toContain('Archive unavailable (No space left on device)')
    expect([...service.custody.values()].every(record => record.state === 'retained')).toBe(true)
    error.mockRestore()
  })

  it('does not misreport copies on unread pages when a full archive disk ends the cycle', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    let failing: 'original' | 'receipt' = 'original'

    const full = await openAcquisitionArchive(directory, {
      ...nodeArchiveFileSystem,
      open: async (path, flags) => {
        if (String(path).includes(failing === 'original' ? 'original.imagebytes' : 'receipt.json'))
          throw new Error('No space left on device')

        return open(path, flags)
      },
    })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const capturing = setup(service, full)

    for (let index = 0; index < 50; index++) await capturing.equipment.acquisition.capture(request)
    // The 51st, on the second page, was published but its receipt write failed.
    failing = 'receipt'
    await capturing.equipment.acquisition.capture(request)
    failing = 'original'

    const report = await setup(service, full).custody.recover()

    expect(report.preserved).toBe(0)
    expect(report.problems).toEqual([expect.stringContaining(': No space left on device'), expect.stringContaining('Archive unavailable')])
    expect([...service.custody.values()].every(record => record.state === 'retained')).toBe(true)
    error.mockRestore()
  })

  it('reports an unreadable Cria record as pending, not as a missing original', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))

    const interrupted = await openAcquisitionArchive(directory, {
      ...nodeArchiveFileSystem,
      open: async (path, flags) => {
        if (String(path).includes('receipt.json')) throw new Error('Interrupted before the receipt')

        return open(path, flags)
      },
    })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await setup(service, interrupted).equipment.acquisition.capture(request)
    const record = [...service.custody.values()][0]!

    // Cria lists nothing as retained, and reading this record fails with a server error.
    const { custody } = setup(service, await openAcquisitionArchive(directory), async (input, init) => {
      const path = new URL(String(input)).pathname

      if (path === '/v2/images') return Response.json({ storeId: service.state.storeId, images: [], next: 0 })

      if (path === `/v2/images/${record.id}`) return failure(503)

      return service.fetch(input, init)
    })

    const report = await custody.recover()

    expect(report.problems).toEqual([expect.stringContaining('Cria custody could not be read')])
    expect(report.problems[0]).toContain('still pending')
    error.mockRestore()
  })

  it('reports no problem when an acquisition finishes its receipt while recovery runs', async () => {
    const service = new ServiceFixture()
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const archive = await openAcquisitionArchive(directory)
    let interrupt = true

    // The first preservation publishes the copy but is interrupted before its receipt.
    const interrupted = await openAcquisitionArchive(directory, {
      ...nodeArchiveFileSystem,
      open: async (path, flags) => {
        if (interrupt && String(path).includes('receipt.json')) throw new Error('Interrupted before the receipt')

        return open(path, flags)
      },
    })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await setup(service, interrupted).equipment.acquisition.capture(request)
    interrupt = false
    const record = [...service.custody.values()][0]!
    let finished = false

    // While recovery lists its work, the copy gets its receipt and Cria accepts it.
    const { custody, client } = setup(service, archive, async (input, init) => {
      if (!finished && new URL(String(input)).pathname === '/v2/images') {
        finished = true
        const expected = expectedAcquisition(record, (await archive.intent(record.storeId, record.requestId)) ?? null)

        await client.acknowledgeArchive((await archive.receipt(expected))!)
      }

      return service.fetch(input, init)
    })

    expect(await custody.recover()).toEqual({ acknowledged: 0, preserved: 0, problems: [] })
    expect(record.state).toBe('archived')
    error.mockRestore()
  })

  it("uses Vela's verified archived copy when another process already archived and released it", async () => {
    const service = new ServiceFixture()

    service.releaseOnReceipt = true
    const directory = await mkdtemp(join(tmpdir(), 'vela-custody-'))
    const delayed = delayedAdmission(service)
    const foreground = setup(service, await openAcquisitionArchive(directory), delayed.fetch)
    const capturing = foreground.equipment.acquisition.capture(request)

    await delayed.reached
    // A separate process (for example one that survived a restart race) does not share ownership.
    expect((await setup(service, await openAcquisitionArchive(directory)).custody.recover()).preserved).toBe(1)
    expect([...service.custody.values()][0]!.state).toBe('released')
    delayed.release()

    expect(Array.from((await capturing).pixels)).toEqual([1, 2, 3, 4, 5, 6])
    expect(service.posts).toHaveLength(1)
    expect(new Set(service.receipts).size).toBe(1)
  })
})
