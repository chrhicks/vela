import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArchiveConflictError, openAcquisitionArchive, type AcquisitionContext, type AcquisitionSource } from './archive.js'

const original = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 0, 44, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 42, 0, 0, 0])

function source(bytes = original): AcquisitionSource {
  return {
    system: 'cria',
    storeId: randomUUID(),
    imageId: randomUUID(),
    operationId: randomUUID(),
    requestId: randomUUID(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    mediaType: 'application/imagebytes',
  }
}

function context(purpose = 'capture'): AcquisitionContext {
  return { acquisition: { purpose, preservedBy: 'acquisition', preservedAt: '2026-10-08T00:00:00.000Z' } }
}

async function root() {
  return mkdtemp(join(tmpdir(), 'vela-acquisitions-'))
}

describe('acquisition archive', () => {
  it('stores the exact bytes and an immutable manifest, and issues one receipt across reopen', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const acquired = source()
    const first = await archive.preserve({ source: acquired, original, context: context('capture') })
    const again = await archive.preserve({ source: acquired, original, context: context('other') })
    const target = join(directory, acquired.storeId, acquired.imageId)

    expect(again).toEqual(first)
    expect(Buffer.from(await readFile(join(target, 'original.imagebytes'))).equals(Buffer.from(original))).toBe(true)
    const manifest = await readFile(join(target, 'context.json'))

    expect(JSON.parse(manifest.toString()).acquisition.purpose).toBe('capture')
    expect(first.archive.contextSha256).toBe(createHash('sha256').update(manifest).digest('hex'))
    expect(first.sha256).toBe(acquired.sha256)

    const reopened = await openAcquisitionArchive(directory)

    expect((await reopened.unacknowledged()).receipts).toEqual([first])
    await reopened.acknowledged(first, 'archived')
    expect((await reopened.unacknowledged()).receipts).toEqual([])
    expect(await reopened.receipt(acquired.storeId, acquired.imageId)).toEqual(first)
  })

  it('refuses bytes that do not match their source and never repairs a changed archive', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const acquired = source()

    await expect(archive.preserve({ source: acquired, original: new Uint8Array(original.byteLength), context: context() }))
      .rejects.toBeInstanceOf(ArchiveConflictError)
    await archive.preserve({ source: acquired, original, context: context() })
    await writeFile(join(directory, acquired.storeId, acquired.imageId, 'original.imagebytes'), new Uint8Array(original.byteLength))

    const pending = await archive.unacknowledged()

    expect(pending.receipts).toEqual([])
    expect(pending.problems[0]).toContain('differs from the Cria source')
    await expect(archive.preserve({ source: acquired, original, context: context() })).rejects.toBeInstanceOf(ArchiveConflictError)
  })

  it('never leaves a partially written receipt under its final name', async () => {
    const directory = await root()
    const acquired = source()
    let failReceipt = true

    // Simulate a crash while the receipt's bytes are being written.
    const failing = await openAcquisitionArchive(directory, async (path, flags) => {
      const file = await open(path, flags)

      if (String(path).includes('receipt.json') && failReceipt) {
        failReceipt = false
        await file.close()
        throw new Error('Simulated crash while writing receipt')
      }

      return file
    })

    await expect(failing.preserve({ source: acquired, original, context: context() })).rejects.toThrow('Simulated crash')
    const target = join(directory, acquired.storeId, acquired.imageId)

    expect((await readdir(target)).sort()).toEqual(['context.json', 'original.imagebytes'])
    expect((await (await openAcquisitionArchive(directory)).unacknowledged()).receipts).toHaveLength(1)
  })

  it('publishes concurrently preserved copies once', async () => {
    const archive = await openAcquisitionArchive(await root())
    const acquired = source()
    const receipts = await Promise.all(Array.from({ length: 4 }, () => archive.preserve({ source: acquired, original, context: context() })))

    expect(new Set(receipts.map(receipt => receipt.receiptId)).size).toBe(1)
  })

  it('discards only its own interrupted staging copies on open', async () => {
    const directory = await root()

    await mkdir(join(directory, '.staging-interrupted'))
    await writeFile(join(directory, '.staging-interrupted', 'original.imagebytes'), original)
    await openAcquisitionArchive(directory)
    expect(await readdir(directory)).toEqual([])
  })

  it('finishes a receipt for a published acquisition whose receipt was never written', async () => {
    const directory = await root()
    const archive = await openAcquisitionArchive(directory)
    const acquired = source()
    const receipt = await archive.preserve({ source: acquired, original, context: context() })

    // A crash after publication but before the receipt file was written.
    await rm(join(directory, acquired.storeId, acquired.imageId, 'receipt.json'))
    const recovered = (await (await openAcquisitionArchive(directory)).unacknowledged()).receipts

    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.receiptId).not.toBe(receipt.receiptId)
    expect(recovered[0]!.archive.contextSha256).toBe(receipt.archive.contextSha256)
  })
})
