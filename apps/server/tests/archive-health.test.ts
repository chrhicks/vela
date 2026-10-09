import { chmod, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CriaClient, type CriaCustody } from '@vela/cria'
import { ServiceFixture, failure, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createCriaCustody } from '../src/cria/custody.js'
import { createArchiveHealth, createArchiveHealthTracker } from '../src/cria/archive-health.js'
import { nodeArchiveFileSystem, openAcquisitionArchive, type ArchiveCensus, type ArchiveFileSystem } from '../src/acquisitions/archive.js'
// What the browser accepts and tells Chris must describe the same event the server publishes.
import { isArchiveHealthView } from '../../web/src/features/archive/validation.js'
import { preservationSummary } from '../../web/src/features/archive/presentation.js'

/** A clock the test advances, so cached reads and acquisition rates are deterministic. */
function clock(start = Date.parse('2026-10-08T22:00:00.000Z')) {
  let current = start

  return { now: () => new Date(current), advance(ms: number) { current += ms } }
}

/** Fails chosen archive writes, as a full or unmounted disk would, until restored. */
function faultyDisk() {
  let failing: RegExp | null = null

  const fs: ArchiveFileSystem = {
    ...nodeArchiveFileSystem,
    open: async (path, flags) => {
      if (failing?.test(String(path))) throw Object.assign(new Error('No space left on device'), { code: 'ENOSPC' })

      return open(path, flags)
    },
  }

  return { fs, fail(pattern: RegExp) { failing = pattern }, restore() { failing = null } }
}

interface SetupOptions {
  fs?: ArchiveFileSystem
  fetch?: typeof fetch
  /** Wraps the archive census the health view sees, to slow or count it. */
  census?: (count: () => Promise<ArchiveCensus>) => Promise<ArchiveCensus>
}

async function setup(service: ServiceFixture, options: SetupOptions = {}) {
  const time = clock()
  const directory = await mkdtemp(join(tmpdir(), 'vela-health-'))
  const archive = await openAcquisitionArchive(directory, options.fs)
  const bindings = service.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName, providerDeviceId: id }))

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    storeId: service.state.storeId,
    devices: bindings.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    fetch: options.fetch ?? service.fetch,
    pollIntervalMs: 1,
    operationTimeoutMs: 1000,
    imageRetryMs: 30,
  })

  onTestFinished(async () => {
    await client.close()
    await archive.close()
  })

  const tracker = createArchiveHealthTracker(time.now)
  const custody = createCriaCustody(client, archive, service.state.storeId, tracker)
  const wrap = options.census
  const seen = wrap ? { ...archive, census: (storeId: string) => wrap(() => archive.census(storeId)) } : archive

  const health = createArchiveHealth({
    client,
    archive: seen,
    tracker,
    storeId: service.state.storeId,
    reconcile: async () => { await custody.recover() },
    owns: requestId => custody.owns(requestId),
    now: time.now,
  })

  const equipment = createCriaEquipment(client, bindings, custody, 'rig-1')

  return { time, directory, archive, client, custody, health, equipment }
}

const capture = (purpose: 'capture' | 'autofocus' | 'framing' | 'alignment' = 'capture') =>
  ({ cameraId: 'camera', exposureSeconds: 0.001, purpose }) as const

const exposures = (service: ServiceFixture) => service.posts.filter(post => post.includes('"capture"')).length

describe('archive health', () => {
  it('counts one preserved original per acquisition whatever its purpose, without Keep', async () => {
    const service = new ServiceFixture()
    const { equipment, health, time } = await setup(service)

    for (const purpose of ['capture', 'autofocus', 'framing', 'alignment'] as const) {
      await equipment.acquisition.capture(capture(purpose))
      time.advance(60_000)
    }

    const view = await health.view()

    expect(view.status).toBe('current')
    expect(view.obligations).toMatchObject({ preserved: { count: 4, bytes: 4 * service.original.byteLength }, waitingAtCria: { count: 0 }, complete: true })
    expect(view.issues.total).toBe(0)
    expect(view.destination).toMatchObject({ state: 'available', intentRefusal: null })
    expect(view.destination.space?.basis).toBe('opened-archive')
  })

  it('says no exposure was requested when intent cannot be recorded', async () => {
    const service = new ServiceFixture()
    const disk = faultyDisk()
    const { equipment, health } = await setup(service, { fs: disk.fs })

    disk.fail(/\.intents/)
    await expect(equipment.acquisition.capture(capture())).rejects.toThrow(/capture not started/)

    const view = await health.view()

    expect(exposures(service)).toBe(0)
    expect(view.destination.intentRefusal?.detail).toBe('No space left on the archive disk')
    // Nothing was acquired, so nothing is waiting and preservation is not degraded.
    expect(view.obligations.waitingAtCria).toEqual({ count: 0, bytes: 0 })
    expect(view.destination.state).toBe('available')

    // Once intent can be recorded again the refusal is resolved, not left as a standing warning.
    disk.restore()
    await equipment.acquisition.capture(capture())
    expect((await health.reconcile()).destination.intentRefusal).toBeNull()
  })

  it('shows a growing backlog while originals cannot be written, then completes it once without another exposure', async () => {
    const service = new ServiceFixture()
    const disk = faultyDisk()
    const { equipment, health, time } = await setup(service, { fs: disk.fs })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    disk.fail(/original\.imagebytes/)

    // The consumer still receives pixels while preservation fails.
    for (let index = 0; index < 3; index++) {
      expect((await equipment.acquisition.capture(capture())).pixels.length).toBe(6)
      time.advance(30_000)
    }

    const degraded = await health.view()

    expect(degraded.status).toBe('degraded')
    expect(degraded.destination).toMatchObject({ state: 'unavailable', problem: { kind: 'write-failed', detail: 'No space left on the archive disk' } })
    expect(degraded.obligations.waitingAtCria).toEqual({ count: 3, bytes: 3 * service.original.byteLength })
    expect(degraded.forecast.criaCapturesBeforeRefusal).toBeGreaterThan(0)
    expect(degraded.issues.total).toBe(0)
    expect([...service.custody.values()].every(record => record.state === 'retained')).toBe(true)

    const published = { rigId: 'rig-1', rigName: 'FRA 400', preservation: 'cria' as const, ...degraded }

    expect(isArchiveHealthView(published, 'rig-1')).toBe(true)
    expect(preservationSummary(published, true).explanation).toBe(
      'Capturing · 3 originals waiting for archive. The Vela archive cannot accept originals: No space left on the archive disk. ' +
      'Cria is retaining them; new captures will be refused when its capacity is exhausted.',
    )

    disk.restore()
    const restored = await health.reconcile()

    expect(restored.status).toBe('current')
    expect(restored.obligations).toMatchObject({ waitingAtCria: { count: 0 }, preserved: { count: 3 } })
    expect(exposures(service)).toBe(3)
    expect(new Set(service.receipts).size).toBe(3)

    // Reconciling again changes nothing: the totals are durable facts, not counters.
    await Promise.all([health.reconcile(), health.reconcile()])
    expect((await health.reconcile()).obligations.preserved).toEqual({ count: 3, bytes: 3 * service.original.byteLength })
    expect(new Set(service.receipts).size).toBe(3)
    error.mockRestore()
  })

  it('counts an original the active capture is still preserving as arriving, not as backlog', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    let reached = () => {}

    const downloading = new Promise<void>(resolve => { reached = resolve })
    const held = new Promise<void>(resolve => { release = resolve })

    const { equipment, health } = await setup(service, {
      fetch: async (input, init) => {
        if (String(input).endsWith('/original')) {
          reached()
          await held
        }

        return service.fetch(input, init)
      },
    })

    const capturing = equipment.acquisition.capture(capture())

    await downloading
    const during = await health.view()

    expect(during.obligations).toMatchObject({ arriving: { count: 1 }, waitingAtCria: { count: 0 } })
    expect(during.status).toBe('current')

    release()
    await capturing
    expect((await health.reconcile()).obligations).toMatchObject({ arriving: { count: 0 }, preserved: { count: 1 } })
  })

  it('treats a lost receipt response as a pending acknowledgement, not a lost image', async () => {
    const service = new ServiceFixture()
    let dropping = true

    const { equipment, health } = await setup(service, {
      fetch: async (input, init) => {
        const response = await service.fetch(input, init)

        if (dropping && String(input).endsWith('/archive-receipt')) throw new TypeError('Simulated lost receipt response')

        return response
      },
    })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await equipment.acquisition.capture(capture())
    const pending = await health.view()

    expect(pending.status).toBe('catching-up')
    expect(pending.obligations).toMatchObject({ acknowledgementPending: { count: 1 }, waitingAtCria: { count: 0 } })
    expect(pending.issues.shown).toEqual([expect.objectContaining({ reason: 'acknowledgement-pending' })])

    dropping = false
    const settled = await health.reconcile()

    expect(settled.status).toBe('current')
    expect(settled.obligations).toMatchObject({ acknowledgementPending: { count: 0 }, preserved: { count: 1 } })
    expect(settled.issues.total).toBe(0)
    error.mockRestore()
  })

  it("keeps one original's conflict while another original completes", async () => {
    const service = new ServiceFixture()
    const disk = faultyDisk()
    const { equipment, health, directory } = await setup(service, { fs: disk.fs })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The first original's copy is published but its receipt cannot be written; then it is altered.
    disk.fail(/receipt\.json/)
    await equipment.acquisition.capture(capture())
    const [damaged] = [...service.custody.values()]

    await writeFile(join(directory, damaged!.storeId, damaged!.id, 'original.imagebytes'), Buffer.alloc(damaged!.image!.original.bytes))
    disk.restore()
    await equipment.acquisition.capture(capture())

    const view = await health.reconcile()

    expect(view.status).toBe('attention')
    expect(view.issues.shown).toEqual([expect.objectContaining({ imageId: damaged!.id, reason: 'original-mismatch' })])
    expect(view.obligations).toMatchObject({ preserved: { count: 1 }, unverified: { count: 1 }, waitingAtCria: { count: 0 } })
    expect(damaged!.state).toBe('retained')
    error.mockRestore()
  })

  it('lists originals Cria reports missing or quarantined, which its outstanding totals omit', async () => {
    const service = new ServiceFixture()
    const { equipment, health } = await setup(service)

    await equipment.acquisition.capture(capture())
    const template = [...service.custody.values()][0]!

    const record = (state: 'missing' | 'quarantined', reason: string): CriaCustody => ({
      ...template,
      id: crypto.randomUUID(),
      state,
      reason,
      image: null,
      receipt: null,
      receiptFingerprint: null,
      receiptAcceptedAt: null,
      candidate: state === 'quarantined' ? { path: 'images/candidate.imagebytes', bytes: 99 } : null,
    })

    const missing = record('missing', 'File vanished after verification')
    const quarantined = record('quarantined', 'Digest verification failed')

    service.custody.set(missing.id, missing)
    service.custody.set(quarantined.id, quarantined)
    const view = await health.view()

    expect(view.status).toBe('attention')
    expect(view.source.missing).toEqual({ count: 1, complete: true })
    expect(view.issues.shown.map(issue => [issue.imageId, issue.reason, issue.detail])).toEqual(expect.arrayContaining([
      [missing.id, 'missing-at-cria', 'File vanished after verification'],
      [quarantined.id, 'quarantined-at-cria', 'Digest verification failed'],
    ]))
  })

  it('does not present an unmounted or replaced archive folder as a healthy archive', async () => {
    const service = new ServiceFixture()
    const { health, directory, time } = await setup(service)

    await rm(directory, { recursive: true })
    const missing = await health.view()

    expect(missing.status).toBe('degraded')
    expect(missing.destination.problem?.kind).toBe('missing')
    expect(missing.destination.space).toMatchObject({ basis: 'other-location' })
    expect(missing.obligations.preserved).toBeNull()
    expect(missing.obligations.partial).toEqual(['archive-unavailable'])

    // An empty folder in its place, as an unmounted mount point would leave.
    await mkdir(directory)
    time.advance(10_000)
    const replaced = await health.view()

    expect(replaced.destination.problem?.kind).toBe('replaced')
    expect(replaced.destination.space?.basis).toBe('other-location')
    expect(replaced.forecast.destinationHours).toBeNull()
  })

  it('reports an archive it cannot list as unavailable, in plain words', async () => {
    const service = new ServiceFixture()
    const { equipment, health, directory } = await setup(service)

    await equipment.acquisition.capture(capture())
    const store = join(directory, [...service.custody.values()][0]!.storeId)

    await chmod(store, 0o000)
    onTestFinished(() => chmod(store, 0o755))

    const view = await health.view()

    expect(view.status).toBe('degraded')
    expect(view.destination.problem).toMatchObject({ kind: 'unreadable', detail: 'The archive could not be listed: Permission denied' })
    expect(view.obligations.partial).toEqual(['archive-unavailable'])
    expect(JSON.stringify(view)).not.toContain(store)
  })

  it('keeps last-known Cria totals with their age when Cria cannot be read', async () => {
    const service = new ServiceFixture()
    const disk = faultyDisk()
    const { equipment, health, time } = await setup(service, { fs: disk.fs })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    disk.fail(/original\.imagebytes/)
    await equipment.acquisition.capture(capture())
    const before = await health.view()

    service.storageFailure = true
    time.advance(60_000)
    const stale = await health.view()

    expect(stale.source).toMatchObject({ current: false, observedAt: before.source.observedAt })
    expect(stale.source.error).toBeTruthy()
    expect(stale.obligations).toMatchObject({ waitingAtCria: { count: 1 }, complete: false, partial: ['cria-last-known'] })
    error.mockRestore()
  })

  it('shares one bounded set of reads between polls and never sends an equipment command', async () => {
    const service = new ServiceFixture()
    const { equipment, health, time } = await setup(service)

    await equipment.acquisition.capture(capture())
    const before = service.paths.length
    const commands = exposures(service)

    await Promise.all([health.view(), health.view(), health.view()])
    await health.view()
    const reads = service.paths.slice(before)

    expect(reads.filter(path => path === 'GET /v2/storage')).toHaveLength(1)
    expect(reads.every(path => path.startsWith('GET '))).toBe(true)

    time.advance(10_000)
    await health.view()
    expect(service.paths.slice(before).filter(path => path === 'GET /v2/storage')).toHaveLength(2)
    expect(exposures(service)).toBe(commands)
  })

  it('forecasts only from measured frames and an observed rate', async () => {
    const service = new ServiceFixture()
    const { equipment, health, time } = await setup(service)

    const first = await health.view()

    expect(first.forecast).toMatchObject({ frameBytes: null, rate: null, rateUnknown: 'too-few-acquisitions', destinationHours: null, criaCapturesBeforeRefusal: null, totalRequirement: 'unknown' })

    await equipment.acquisition.capture(capture())
    time.advance(120_000)
    await equipment.acquisition.capture(capture())
    time.advance(10_000)
    const acquiring = await health.view()

    expect(acquiring.forecast.frameBytes?.bytes).toBe(service.original.byteLength)
    expect(acquiring.forecast.rate?.framesPerHour).toBe(30)
    expect(acquiring.forecast.destinationHours).toBeGreaterThan(0)

    // Cria's rule: refuse once committed bytes plus one reservation exceed its budget.
    service.budgetBytes = 2 * service.original.byteLength + service.reservationBytes + 3 * service.original.byteLength
    time.advance(10_000)
    expect((await health.view()).forecast.criaCapturesBeforeRefusal).toBe(4)

    time.advance(3_600_000)
    expect((await health.view()).forecast).toMatchObject({ rate: null, rateUnknown: 'not-acquiring', destinationHours: null })
  })

  it('measures the rate over the latest unbroken run, not across a pause', async () => {
    const service = new ServiceFixture()
    const { equipment, health, time } = await setup(service)

    for (let frame = 0; frame < 8; frame++) {
      await equipment.acquisition.capture(capture())
      time.advance(60_000)
    }

    time.advance(2 * 3_600_000)

    for (let frame = 0; frame < 2; frame++) {
      await equipment.acquisition.capture(capture())
      time.advance(60_000)
    }

    expect((await health.view()).forecast.rate).toMatchObject({ framesPerHour: 60, frames: 2 })
  })

  it('does not merge an autofocus burst into the following capture rate', async () => {
    const service = new ServiceFixture()
    const { equipment, health, time } = await setup(service)

    for (let frame = 0; frame < 9; frame++) {
      await equipment.acquisition.capture(capture('autofocus'))
      time.advance(3_000)
    }

    time.advance(60_000)
    await equipment.acquisition.capture(capture())

    for (let frame = 0; frame < 2; frame++) {
      time.advance(300_000)
      await equipment.acquisition.capture(capture())
    }

    time.advance(100_000)
    expect((await health.view()).forecast.rate).toMatchObject({ framesPerHour: 12, frames: 3 })
  })

  it('reports Cria read failures without inventing an archive problem', async () => {
    const service = new ServiceFixture()

    const { health } = await setup(service, {
      fetch: async (input, init) => new URL(String(input)).pathname === '/v2/storage' ? failure(503) : service.fetch(input, init),
    })

    const view = await health.view()

    expect(view.status).toBe('unknown')
    expect(view.source).toMatchObject({ current: false, observedAt: null, capacity: null })
    expect(view.destination.state).toBe('available')
    expect(view.obligations.waitingAtCria).toBeNull()
  })
  it('answers within its deadline while a slow first census finishes in the background', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    let censuses = 0
    const gate = new Promise<void>(resolve => { release = resolve })

    const { equipment, health, time } = await setup(service, {
      census: async count => {
        censuses++
        await gate

        return count()
      },
    })

    await equipment.acquisition.capture(capture())
    const started = performance.now()
    const [first, second] = await Promise.all([health.view(), health.view()])

    expect(performance.now() - started).toBeLessThan(3_000)
    expect(first).toBe(second)
    expect(censuses).toBe(1)
    expect(first.status).toBe('unknown')
    expect(first.obligations).toMatchObject({ preserved: null, archiveCountedAt: null, complete: false, partial: ['archive-not-counted'] })

    release()
    await new Promise(resolve => setTimeout(resolve, 10))
    time.advance(10_000)
    const counted = await health.view()

    expect(counted.status).toBe('current')
    expect(counted.obligations).toMatchObject({ preserved: { count: 1 }, complete: true })
    expect(censuses).toBe(1)
  })

  it('stops calling an old census current while a new one is still running', async () => {
    const service = new ServiceFixture()
    let blocking = false
    let release = () => {}

    const { equipment, health, time } = await setup(service, {
      census: async count => {
        if (blocking) await new Promise<void>(resolve => { release = resolve })

        return count()
      },
    })

    await equipment.acquisition.capture(capture())
    expect((await health.view()).obligations.complete).toBe(true)

    blocking = true
    time.advance(120_000)
    const old = await health.view()

    expect(old.obligations).toMatchObject({ preserved: { count: 1 }, complete: false, partial: ['archive-count-old'] })
    expect(Date.parse(old.observedAt) - Date.parse(old.obligations.archiveCountedAt!)).toBe(120_000)
    expect(old.status).toBe('unknown')
    release()
  })

  it("does not raise attention when Cria's extra copy vanished after Vela preserved it", async () => {
    const service = new ServiceFixture()
    const { equipment, health } = await setup(service)

    await equipment.acquisition.capture(capture())
    const [record] = [...service.custody.values()]

    // Cria kept its copy after the receipt, then found its file gone.
    Object.assign(record!, { state: 'missing', reason: 'File vanished after verification' })
    const view = await health.view()

    expect(view.source.missing).toEqual({ count: 1, complete: true })
    expect(view.issues.total).toBe(0)
    expect(view.status).toBe('current')
  })

  it('reports missing records beyond the pages read as partial, never as invented issues', async () => {
    const service = new ServiceFixture()
    const { equipment, health } = await setup(service)

    await equipment.acquisition.capture(capture())
    const template = [...service.custody.values()][0]!

    for (let index = 0; index < 600; index++) {
      const id = crypto.randomUUID()

      service.custody.set(id, { ...template, id, state: 'missing', reason: 'File vanished', image: null, receipt: null, receiptFingerprint: null, receiptAcceptedAt: null })
    }

    const view = await health.view()

    expect(view.source.missing).toEqual({ count: 500, complete: false })
    expect(view.obligations.partial).toContain('missing-unchecked')
    expect(view.issues.needsAttention).toBe(500)
    expect(view.issues.needsAttention).toBeLessThanOrEqual(view.issues.total)
    expect(view.status).toBe('attention')

    const published = { rigId: 'rig-1', rigName: 'FRA 400', preservation: 'cria' as const, ...view }

    expect(isArchiveHealthView(published, 'rig-1')).toBe(true)
    expect(preservationSummary(published, false).title).toBe('500 or more originals need attention')
  })

  it('waits for the archive count before treating Cria missing records as lost', async () => {
    const service = new ServiceFixture()
    let release = () => {}

    const gate = new Promise<void>(resolve => { release = resolve })

    const { equipment, health } = await setup(service, {
      census: async count => {
        await gate

        return count()
      },
    })

    await equipment.acquisition.capture(capture())
    Object.assign([...service.custody.values()][0]!, { state: 'missing', reason: 'File vanished after verification' })
    const early = await health.view()

    expect(early.issues.total).toBe(0)
    expect(early.status).toBe('unknown')
    release()
  })

  it('never counts an archived entry whose original file is gone as preserved', async () => {
    const service = new ServiceFixture()
    const { equipment, health, directory } = await setup(service)

    await equipment.acquisition.capture(capture())
    const [record] = [...service.custody.values()]

    await rm(join(directory, record!.storeId, record!.id, 'original.imagebytes'))
    const view = await health.view()

    expect(view.obligations.preserved).toEqual({ count: 0, bytes: 0 })
    expect(view.status).toBe('attention')
    expect(view.issues.shown).toEqual([expect.objectContaining({ imageId: record!.id, reason: 'original-mismatch', detail: 'The archived original file is missing' })])
  })

  it('returns a reading taken after Check archive now, not one already in flight', async () => {
    const service = new ServiceFixture()
    const disk = faultyDisk()
    let holdStorage = false
    let releaseStorage = () => {}

    let storageHeld = () => {}

    const held = new Promise<void>(resolve => { storageHeld = resolve })

    const { equipment, health, time } = await setup(service, {
      fs: disk.fs,
      fetch: async (input, init) => {
        const response = await service.fetch(input, init)

        // Cria has answered; only its reply is delayed, so this reading predates the check.
        if (holdStorage && new URL(String(input)).pathname === '/v2/storage') {
          holdStorage = false
          storageHeld()
          await new Promise<void>(resolve => { releaseStorage = resolve })
        }

        return response
      },
    })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    disk.fail(/original\.imagebytes/)
    await equipment.acquisition.capture(capture())
    expect((await health.view()).status).toBe('degraded')

    // A browser poll is mid-read when the disk is restored and the check runs.
    time.advance(10_000)
    holdStorage = true
    const poll = health.view()

    await held
    disk.restore()
    const checking = health.reconcile()

    await vi.waitFor(() => expect(service.receipts).toHaveLength(1))
    releaseStorage()

    expect((await poll).status).not.toBe('current')
    expect(await checking).toMatchObject({ status: 'current', obligations: { preserved: { count: 1 }, waitingAtCria: { count: 0 } } })
    error.mockRestore()
  })
})
