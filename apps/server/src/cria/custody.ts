import { CriaApiError, type CriaClient, type CriaCustody } from '@vela/cria'
import {
  ArchiveConflictError,
  ExpectedAcquisitionSchema,
  type AcquisitionArchive,
  type AcquisitionIntent,
  type ArchiveReceipt,
  type ExpectedAcquisition,
} from '../acquisitions/archive.js'
import { z } from 'zod'
import { classifyArchiveFailure, createArchiveHealthTracker, provenanceOf, type ArchiveHealthTracker } from './archive-health.js'

export interface CriaCustodyReport {
  acknowledged: number
  preserved: number
  problems: string[]
}

/** A receipt conflict means another archive's receipt was accepted first. */
function isReceiptConflict(error: Error | null): error is CriaApiError {
  return error instanceof CriaApiError && error.code === 'receipt-conflict'
}

function problem(error: Error | null, fallback: string) {
  if (isReceiptConflict(error)) return 'Cria accepted a different archive receipt for this original; another archive holds it'

  return error?.message ?? fallback
}

/**
 * The acquisition Vela can vouch for: Cria's authoritative custody record plus Vela's own
 * recorded intent. Missing or inconsistent context fails here rather than being certified.
 */
export function expectedAcquisition(record: CriaCustody, intent: AcquisitionIntent | null): ExpectedAcquisition {
  const image = record.image

  if (!image) throw new ArchiveConflictError('Cria custody has no verified original', 'context')

  const expected = ExpectedAcquisitionSchema.safeParse({
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

  if (!expected.success)
    throw new ArchiveConflictError(`Cria's acquisition record cannot be vouched for: ${z.prettifyError(expected.error)}`, 'context')

  return expected.data
}

/**
 * Moves each Cria original into Vela's acquisition archive and returns the verified receipt to
 * Cria, which may then release its redundant copy. A failed transfer or archive is repaired by
 * fetching the same original again; this never requests another exposure.
 */
export function createCriaCustody(
  client: CriaClient,
  archive: AcquisitionArchive,
  storeId: string,
  /** Observed attempts for the archive health view; recovery itself never depends on it. */
  tracker: ArchiveHealthTracker = createArchiveHealthTracker(),
) {
  // Requests an active acquisition owns, from before they are sent until its frame is returned.
  const owned = new Set<string>()
  let recovering: Promise<CriaCustodyReport> | undefined

  async function intentOf(record: CriaCustody) {
    return record.requestId ? await archive.intent(storeId, record.requestId).catch(() => undefined) ?? null : null
  }

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

    for (const damaged of local.damaged)
      tracker.failed(damaged.imageId, { scope: 'image', reason: `${damaged.subject}-mismatch`, detail: damaged.message }, provenanceOf(undefined))

    for (const receipt of local.receipts) {
      try {
        await acknowledge(receipt)
        report.acknowledged++
        tracker.preserved(receipt.imageId)
      } catch (error) {
        report.problems.push(`${receipt.imageId}: ${problem(error instanceof Error ? error : null, 'acknowledgement failed')}`)
        tracker.failed(receipt.imageId, classifyArchiveFailure(error instanceof Error ? error : null, 'acknowledge'), { requestId: null, operationId: receipt.operationId, purpose: null })
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

        let stage: 'preserve' | 'acknowledge' = 'preserve'

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

          stage = 'acknowledge'
          await acknowledge(receipt)
          report.preserved++
          tracker.preserved(record.id)
        } catch (error) {
          report.problems.push(`${record.id}: ${problem(error instanceof Error ? error : null, 'preservation failed')}`)
          tracker.failed(record.id, classifyArchiveFailure(error instanceof Error ? error : null, stage), provenanceOf(record, await intentOf(record)))
        }
      }

      // Cria drops records that change state while it reads a page, so a short page is not the
      // end. Stop only when the cursor no longer advances.
      if (page.next <= after) break
      after = page.next
    }

    if (archiveUnavailable !== null) {
      report.problems.push(`Archive unavailable (${archiveUnavailable}); remaining originals deferred to the next cycle`)
      tracker.failed('', { scope: 'destination', detail: archiveUnavailable }, provenanceOf(undefined))
    }

    // A published copy without a receipt whose original Cria no longer retains cannot be vouched for,
    // unless an active acquisition finished it meanwhile: then Cria holds Vela's receipt.
    for (const imageId of unreceipted) {
      let record: CriaCustody | undefined

      try {
        record = await client.custody(imageId)
      } catch (error) {
        // Only a confirmed unknown image means Cria does not retain it; anything else is unread.
        if (!(error instanceof CriaApiError && error.status === 404)) {
          const detail = `Cria custody could not be read (${(error instanceof Error ? error.message : 'unreadable')}); still pending`

          report.problems.push(`${imageId}: ${detail}`)
          tracker.failed(imageId, { scope: 'image', reason: 'source-unavailable', detail }, provenanceOf(undefined))
          continue
        }
      }

      // Still retained (for example on a page this cycle never read) or owned: pending, not a problem.
      if (record && (owned.has(record.requestId) || record.state === 'retained')) continue

      // Read-only: this check must never issue a receipt for a copy it cannot vouch for.
      const finished = record?.receipt && await archive.issuedReceipt(storeId, imageId).catch(() => undefined)

      if (finished && finished.receiptId === record?.receipt?.receiptId) {
        tracker.settled(imageId)
        continue
      }

      const detail = record?.receipt
        ? "Cria accepted another archive's receipt for this original; this archive's unreceipted copy is not vouched for"
        : 'archived without a receipt, but Cria does not retain this original'

      report.problems.push(`${imageId}: ${detail}`)
      tracker.failed(imageId, { scope: 'image', reason: record?.receipt ? 'receipt-conflict' : 'unvouched-copy', detail }, provenanceOf(record))
    }

    return report
  }

  return {
    storeId,
    tracker,
    /** Record intent durably and take ownership of the request before it is sent. */
    async intend(intent: AcquisitionIntent) {
      try {
        await archive.recordIntent(intent)
      } catch (error) {
        tracker.intentRefused(error instanceof Error ? error.message : 'intent not recorded')
        throw new Error(`Acquisition archive unavailable; capture not started: ${error instanceof Error ? error.message : 'intent not recorded'}`, { cause: error })
      }

      tracker.intentRecorded()
      owned.add(intent.requestId)
    },
    /** The acquisition is done with this request; recovery may now finish its archive work. */
    disown(requestId: string) {
      owned.delete(requestId)
    },
    /** Preserve a just-acquired original before any consumer processes its pixels. */
    async preserveAcquisition(imageId: string, original: Uint8Array) {
      tracker.acquired(original.byteLength)
      let record: CriaCustody | undefined
      let stage: 'preserve' | 'acknowledge' = 'preserve'

      try {
        record = await client.custody(imageId)
        const receipt = await archive.preserve({ expected: await expectedFor(record), original, preservedBy: 'acquisition' })

        stage = 'acknowledge'
        await acknowledge(receipt)
        tracker.preserved(imageId)
      } catch (error) {
        tracker.failed(imageId, classifyArchiveFailure(error instanceof Error ? error : null, stage), provenanceOf(record, record && await intentOf(record)))
        throw error
      }
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
    /** Resolves once no recovery pass is running, so shutdown can release the archive safely. */
    async idle() {
      await recovering?.catch(() => {})
    },
  }
}

export type CriaCustodyCoordinator = ReturnType<typeof createCriaCustody>
