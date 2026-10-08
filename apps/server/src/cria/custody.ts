import type { CriaClient, CriaCustody } from '@vela/cria'
import {
  ArchiveConflictError,
  ExpectedAcquisitionSchema,
  type AcquisitionArchive,
  type AcquisitionIntent,
  type ArchiveReceipt,
  type ExpectedAcquisition,
} from '../acquisitions/archive.js'

export interface CriaCustodyReport {
  acknowledged: number
  preserved: number
  problems: string[]
}

/**
 * The acquisition Vela can vouch for: Cria's authoritative custody record plus Vela's own
 * recorded intent. Missing or inconsistent context fails here rather than being certified.
 */
export function expectedAcquisition(record: CriaCustody, intent: AcquisitionIntent | null): ExpectedAcquisition {
  const image = record.image

  if (!image) throw new Error('Cria custody has no verified original')

  return ExpectedAcquisitionSchema.parse({
    source: {
      system: 'cria',
      storeId: record.storeId,
      imageId: record.id,
      operationId: record.operationId,
      requestId: record.requestId,
      sha256: image.sha256,
      bytes: image.original.bytes,
      mediaType: 'application/imagebytes',
    },
    cria: {
      identities: {
        instanceId: record.instanceId,
        deviceId: record.deviceId,
        bindingId: record.bindingId,
        cameraName: record.cameraName,
        reservedAt: record.reservedAt,
      },
      image,
      context: record.context,
    },
    intent,
  })
}

/**
 * Moves each Cria original into Vela's acquisition archive and returns the verified receipt to
 * Cria, which may then release its redundant copy. A failed transfer or archive is repaired by
 * fetching the same original again; this never requests another exposure.
 */
export function createCriaCustody(client: CriaClient, archive: AcquisitionArchive, storeId: string) {
  // Requests an active acquisition owns, from before they are sent until its frame is returned.
  const owned = new Set<string>()
  let recovering: Promise<CriaCustodyReport> | undefined

  async function expectedFor(record: CriaCustody) {
    const intent = record.requestId ? await archive.intent(storeId, record.requestId) : undefined

    return expectedAcquisition(record, intent ?? null)
  }

  async function acknowledge(receipt: ArchiveReceipt) {
    const accepted = await client.acknowledgeArchive(receipt)

    await archive.acknowledged(receipt, accepted.state)
  }

  async function recoverOnce(): Promise<CriaCustodyReport> {
    const report: CriaCustodyReport = { acknowledged: 0, preserved: 0, problems: [] }
    const local = await archive.unacknowledged(storeId)
    const unreceipted = new Set(local.unreceipted)

    report.problems.push(...local.problems)

    for (const receipt of local.receipts) {
      try {
        await acknowledge(receipt)
        report.acknowledged++
      } catch (error) {
        report.problems.push(`${receipt.imageId}: ${error instanceof Error ? error.message : 'acknowledgement failed'}`)
      }
    }

    // An archive that cannot write fails every original the same way. One failed write ends the
    // cycle, so a failing disk does not re-download every retained original every cycle.
    let archiveUnavailable: string | null = null

    for (let after = 0; archiveUnavailable === null;) {
      const page = await client.retainedOriginals(after)

      for (const record of page.images) {
        unreceipted.delete(record.id)

        if (owned.has(record.requestId) || archiveUnavailable !== null) continue

        try {
          const expected = await expectedFor(record)
          let receipt = await archive.receipt(expected)

          if (!receipt) {
            const original = await client.originalOf(record)

            receipt = await archive.preserve({ expected, original, preservedBy: 'recovery' }).catch(error => {
              if (!(error instanceof ArchiveConflictError))
                archiveUnavailable = error instanceof Error ? error.message : 'archive write failed'
              throw error
            })
          }

          await acknowledge(receipt)
          report.preserved++
        } catch (error) {
          report.problems.push(`${record.id}: ${error instanceof Error ? error.message : 'preservation failed'}`)
        }
      }

      // Cria drops records that change state while it reads a page, so a short page is not the
      // end. Stop only when the cursor no longer advances.
      if (page.next <= after) break
      after = page.next
    }

    if (archiveUnavailable !== null)
      report.problems.push(`Archive unavailable (${archiveUnavailable}); remaining originals deferred to the next cycle`)

    // A published copy without a receipt whose original Cria no longer retains cannot be vouched for,
    // unless an active acquisition finished it meanwhile: then Cria holds Vela's receipt.
    for (const imageId of unreceipted) {
      const record = await client.custody(imageId).catch(() => undefined)

      // Still retained (for example on a page this cycle never read) or owned: pending, not a problem.
      if (record && (owned.has(record.requestId) || record.state === 'retained')) continue

      const finished = record?.receipt &&
        await expectedFor(record).then(expected => archive.receipt(expected)).catch(() => undefined)

      if (finished && finished.receiptId === record?.receipt?.receiptId) continue
      report.problems.push(`${imageId}: archived without a receipt, but Cria does not retain this original`)
    }

    return report
  }

  return {
    storeId,
    /** Record intent durably and take ownership of the request before it is sent. */
    async intend(intent: AcquisitionIntent) {
      await archive.recordIntent(intent)
      owned.add(intent.requestId)
    },
    /** The acquisition is done with this request; recovery may now finish its archive work. */
    disown(requestId: string) {
      owned.delete(requestId)
    },
    /** Preserve a just-acquired original before any consumer processes its pixels. */
    async preserveAcquisition(imageId: string, original: Uint8Array) {
      const record = await client.custody(imageId)
      const receipt = await archive.preserve({ expected: await expectedFor(record), original, preservedBy: 'acquisition' })

      await acknowledge(receipt)
    },
    /** The same verified original from Vela's archive, if it already holds a receipted copy. */
    archivedOriginal(imageId: string) {
      return archive.original(storeId, imageId)
    },
    /**
     * Finish interrupted work: resend verified receipts Cria has not acknowledged, and archive
     * originals Cria still retains, including results of operations that remain uncertain.
     */
    recover(): Promise<CriaCustodyReport> {
      recovering ??= recoverOnce().finally(() => { recovering = undefined })

      return recovering
    },
  }
}

export type CriaCustodyCoordinator = ReturnType<typeof createCriaCustody>
