import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ArchiveConflictError,
  nodeArchiveFileSystem,
  openAcquisitionArchive,
  type AcquisitionManifest,
  type ArchiveFileSystem,
  type ExpectedAcquisition,
} from './archive.js'

const original = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 44, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 42, 0, 0, 0])

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function acquisition(purpose: 'capture' | 'autofocus' | null = 'capture'): ExpectedAcquisition {
  const storeId = randomUUID()
  const imageId = randomUUID()
  const operationId = randomUUID()
  const requestId = randomUUID()
  const identities = { instanceId: randomUUID(), deviceId: 'camera', bindingId: randomUUID(), cameraName: 'FIXTURE camera', reservedAt: 1 }

  return {
    source: {
      system: 'cria', storeId, imageId, operationId, requestId,
      sha256: sha256(original), bytes: original.byteLength, mediaType: 'application/imagebytes',
    },
    cria: {
      identities,
      image: {
        id: imageId, operationId, instanceId: identities.instanceId, deviceId: 'camera', cameraName: identities.cameraName,
        bindingId: identities.bindingId, width: 1, height: 1, binX: 1, binY: 1, startX: 0, startY: 0, exposureSeconds: 2,
        color: 'mono', capturedAt: 2, capturedAtSource: 'camera', retainedAt: 3, sha256: sha256(original),
        original: { mediaType: 'application/imagebytes', bytes: original.byteLength, url: `/v2/images/${imageId}/original` },
        preview: null,
      },
      context: {
        version: 1,
        requested: { exposureSeconds: 2, light: true },
        cameraObservations: {
          gain: { value: 10, observedAt: 1, checkedAt: 1, readStartedAt: 1, generation: 4, status: 'current', message: null },
        },
        observationsNote: 'Latest Cria readings when the capture was admitted',
      },
    },
    intent: purpose === null ? null : {
      version: 1, storeId, requestId, rigId: 'fra400', deviceId: 'camera', expectedCameraName: 'FIXTURE camera',
      purpose, exposureSeconds: 2, recordedAt: '2026-10-08T00:00:00.000Z',
    },
  }
}

async function root() {
  return mkdtemp(join(tmpdir(), 'vela-acquisitions-'))
}

const target = (directory: string, expected: ExpectedAcquisition) =>
  join(directory, expected.source.storeId, expected.source.imageId)

/** Records publication steps and can fail at one of them, like a crash or I/O error there. */
function recording(failAt = -1) {
  const steps: string[] = []

  function step(name: string) {
    steps.push(name)

    if (steps.length - 1 === failAt) throw new Error(`Injected failure at ${name}`)
  }

  const fs: ArchiveFileSystem = {
    open: async (path, flags) => {
      step(`open ${String(path)}`)

      return open(path, flags)
    },
    mkdir: async path => {
      step(`mkdir ${path}`)
      await nodeArchiveFileSystem.mkdir(path)
    },
    rename: async (from, to) => {
      step(`rename ${from} -> ${to}`)
      await nodeArchiveFileSystem.rename(from, to)
    },
    syncDirectory: async path => {
      step(`sync ${path}`)
      await nodeArchiveFileSystem.syncDirectory(path)
    },
  }

  return { fs, steps }
}

/** Publish without a receipt, as if interrupted just before writing it. */
async function publishedWithoutReceipt(directory: string, expected: ExpectedAcquisition) {
  const interrupted = await openAcquisitionArchive(directory, {
    ...nodeArchiveFileSystem,
    open: async (path, flags) => {
      if (String(path).includes('receipt.json')) throw new Error('Interrupted before the receipt')

      return open(path, flags)
    },
  })

  await expect(interrupted.preserve({ expected, original, preservedBy: 'acquisition' })).rejects.toThrow('Interrupted')
  expect((await readdir(target(directory, expected))).sort()).toEqual(['context.json', 'original.imagebytes'])
}

async function editManifest(directory: string, expected: ExpectedAcquisition, edit: (manifest: AcquisitionManifest) => void) {
  const path = join(target(directory, expected), 'context.json')
  // SAFETY: this file was just written by the archive from a validated manifest.
  const manifest = JSON.parse(await readFile(path, 'utf8')) as AcquisitionManifest

  edit(manifest)
  await writeFile(path, JSON.stringify(manifest))
}

describe('acquisition archive', () => {
  it('stores the exact bytes and a complete manifest, and issues one receipt across reopen', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const expected = acquisition()
    const first = await archive.preserve({ expected, original, preservedBy: 'acquisition' })
    const again = await archive.preserve({ expected, original, preservedBy: 'recovery' })

    expect(again).toEqual(first)
    expect(Buffer.from(await readFile(join(target(directory, expected), 'original.imagebytes'))).equals(Buffer.from(original))).toBe(true)
    const manifestBytes = await readFile(join(target(directory, expected), 'context.json'))
    const manifest = JSON.parse(manifestBytes.toString())

    expect(manifest.intent.purpose).toBe('capture')
    expect(manifest.preservation.by).toBe('acquisition')
    expect(first.archive.contextSha256).toBe(sha256(manifestBytes))

    const reopened = await openAcquisitionArchive(directory)

    expect((await reopened.unacknowledged(expected.source.storeId)).receipts).toEqual([first])
    await reopened.acknowledged(first, 'archived')
    expect(await reopened.unacknowledged(expected.source.storeId)).toEqual({ receipts: [], unreceipted: [], problems: [] })
    expect(await reopened.receipt(expected)).toEqual(first)
    expect(Buffer.from((await reopened.original(expected.source.storeId, expected.source.imageId))!).equals(Buffer.from(original))).toBe(true)
  })

  it('records intent durably and reads it back by request', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const { intent } = acquisition('autofocus')

    await archive.recordIntent(intent!)
    expect(await (await openAcquisitionArchive(directory)).intent(intent!.storeId, intent!.requestId)).toEqual(intent)
  })

  it('refuses bytes that do not match their source and never repairs a changed original', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const expected = acquisition()

    await expect(archive.preserve({ expected, original: new Uint8Array(original.byteLength), preservedBy: 'acquisition' }))
      .rejects.toBeInstanceOf(ArchiveConflictError)
    await archive.preserve({ expected, original, preservedBy: 'acquisition' })
    await writeFile(join(target(directory, expected), 'original.imagebytes'), new Uint8Array(original.byteLength))

    const pending = await archive.unacknowledged(expected.source.storeId)

    expect(pending.receipts).toEqual([])
    expect(pending.problems[0]).toContain('differs from the Cria source')
    await expect(archive.preserve({ expected, original, preservedBy: 'acquisition' })).rejects.toBeInstanceOf(ArchiveConflictError)
    expect(await archive.original(expected.source.storeId, expected.source.imageId).catch(error => error)).toBeInstanceOf(ArchiveConflictError)
  })

  it('never issues a receipt for a manifest reduced to its source identity', async () => {
    // Promoted from the independent review probe: a still-valid JSON manifest with no context.
    const directory = await root()
    const expected = acquisition('autofocus')

    await publishedWithoutReceipt(directory, expected)
    await writeFile(join(target(directory, expected), 'context.json'), JSON.stringify({ version: 1, source: expected.source }))
    const archive = await openAcquisitionArchive(directory)
    const pending = await archive.unacknowledged(expected.source.storeId)

    expect(pending.receipts).toEqual([])
    expect(pending.problems[0]).toContain('incomplete or inconsistent')
    await expect(archive.receipt(expected)).rejects.toBeInstanceOf(ArchiveConflictError)
    expect(await readdir(target(directory, expected))).not.toContain('receipt.json')
  })

  it.each<[string, (m: AcquisitionManifest) => void]>([
    ['request identity', m => {
      m.source.requestId = randomUUID()
      m.intent!.requestId = m.source.requestId
    }],
    ['operation identity', m => {
      m.source.operationId = randomUUID()
      m.cria.image.operationId = m.source.operationId
    }],
    ['binding identity', m => {
      m.cria.identities.bindingId = randomUUID()
      m.cria.image.bindingId = m.cria.identities.bindingId
    }],
    ['intent store', m => { m.intent!.storeId = randomUUID() }],
    ['requested setting', m => { m.cria.context.requested!.exposureSeconds = 30 }],
    ['labelled observation', m => {
      if ('cameraObservations' in m.cria.context) m.cria.context.cameraObservations.gain!.value = 300
    }],
    ['acquisition purpose', m => { m.intent!.purpose = 'capture' }],
    ['missing intent', m => { m.intent = null }],
  ])('refuses a receipt when the stored %s differs from the expected acquisition', async (_name, edit) => {
    const directory = await root()
    const expected = acquisition('autofocus')

    await publishedWithoutReceipt(directory, expected)
    await editManifest(directory, expected, edit)
    const archive = await openAcquisitionArchive(directory)

    await expect(archive.receipt(expected)).rejects.toBeInstanceOf(ArchiveConflictError)
    await expect(archive.preserve({ expected, original, preservedBy: 'recovery' })).rejects.toBeInstanceOf(ArchiveConflictError)
    expect(await readdir(target(directory, expected))).not.toContain('receipt.json')
  })

  it('keeps an existing receipt bound to the manifest it was issued for', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const expected = acquisition()

    await archive.preserve({ expected, original, preservedBy: 'acquisition' })
    // Same JSON content, different bytes: the receipt's context digest no longer matches.
    await editManifest(directory, expected, () => {})
    const pending = await archive.unacknowledged(expected.source.storeId)

    expect(pending.receipts).toEqual([])
    expect(pending.problems[0]).toContain('receipt does not match its files')
    await expect(archive.receipt(expected)).rejects.toBeInstanceOf(ArchiveConflictError)
  })

  it('finishes a published acquisition only against its expected context', async () => {
    const directory = await root()
    const expected = acquisition()

    await publishedWithoutReceipt(directory, expected)
    const archive = await openAcquisitionArchive(directory)

    expect(await archive.unacknowledged(expected.source.storeId)).toEqual({ receipts: [], unreceipted: [expected.source.imageId], problems: [] })
    const receipt = await archive.receipt(expected)

    expect(receipt?.archive.contextSha256).toBe(sha256(await readFile(join(target(directory, expected), 'context.json'))))
  })

  it('publishes concurrently preserved copies once', async () => {
    const archive = await openAcquisitionArchive(await root())
    const expected = acquisition()
    const receipts = await Promise.all(Array.from({ length: 4 }, () => archive.preserve({ expected, original, preservedBy: 'acquisition' })))

    expect(new Set(receipts.map(receipt => receipt.receiptId)).size).toBe(1)
  })

  it('discards only its own interrupted staging copies on open', async () => {
    const directory = await root()

    await mkdir(join(directory, '.staging-interrupted'))
    await writeFile(join(directory, '.staging-interrupted', 'original.imagebytes'), original)
    await openAcquisitionArchive(directory)
    expect(await readdir(directory)).toEqual([])
  })

  it('makes every new directory durable in its parent before a receipt exists', async () => {
    const base = await root()
    const directory = join(base, 'new', 'archive')
    const expected = acquisition()
    const { fs, steps } = recording()
    const archive = await openAcquisitionArchive(directory, fs)

    await archive.preserve({ expected, original, preservedBy: 'acquisition' })
    const store = join(directory, expected.source.storeId)
    const final = target(directory, expected)
    const index = (step: string) => steps.indexOf(step)
    const renameInto = steps.findIndex(step => step.startsWith('rename') && step.endsWith(`-> ${final}`))
    const receiptRename = steps.findIndex(step => step.startsWith('rename') && step.endsWith(join(final, 'receipt.json')))

    // Archive root and its missing ancestor: each created, then its parent synced.
    expect(steps.slice(0, 4)).toEqual([`mkdir ${join(base, 'new')}`, `sync ${base}`, `mkdir ${directory}`, `sync ${join(base, 'new')}`])
    // Store directory linked durably in the root before the acquisition is renamed into it.
    expect(index(`mkdir ${store}`)).toBeLessThan(index(`sync ${directory}`))
    expect(index(`sync ${directory}`)).toBeLessThan(renameInto)
    expect(renameInto).toBeLessThan(steps.lastIndexOf(`sync ${store}`))
    // The receipt appears only after the acquisition's own entry is synced, and is synced itself.
    expect(steps.lastIndexOf(`sync ${store}`)).toBeLessThan(receiptRename)
    expect(steps[receiptRename + 1]).toBe(`sync ${final}`)
  })

  it('issues no receipt when any publication step fails, and re-links the path before one after reopen', async () => {
    const expected = acquisition()
    const { fs: probe, steps } = recording()

    await (await openAcquisitionArchive(join(await root(), 'archive'), probe)).preserve({ expected, original, preservedBy: 'acquisition' })

    for (let failAt = 0; failAt < steps.length; failAt++) {
      const directory = join(await root(), 'archive')
      const { fs } = recording(failAt)

      const outcome = await openAcquisitionArchive(directory, fs)
        .then(archive => archive.preserve({ expected, original, preservedBy: 'acquisition' }))
        .then(() => 'receipt', () => 'failed')

      // Every injected failure surfaces, so no receipt reaches Cria from the interrupted attempt.
      expect(outcome, steps[failAt]).toBe('failed')

      const { fs: reopenFs, steps: reopenSteps } = recording()
      const reopened = await openAcquisitionArchive(directory, reopenFs)
      const listed = (await reopened.unacknowledged(expected.source.storeId)).receipts[0]
      const receipt = listed ?? await reopened.receipt(expected) ?? await reopened.preserve({ expected, original, preservedBy: 'recovery' })
      const store = join(directory, expected.source.storeId)

      expect(receipt.sha256).toBe(expected.source.sha256)

      // Whatever survived, the path to the copy and the receipt is synced before it is returned.
      for (const synced of [directory, store, target(directory, expected)])
        expect(reopenSteps, `${failAt} ${steps[failAt]} -> ${synced}\n${reopenSteps.join('\n')}`).toContain(`sync ${synced}`)
    }
  })
})
