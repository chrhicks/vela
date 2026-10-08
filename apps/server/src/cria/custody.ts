import type { AcquisitionPurpose } from '@vela/equipment'
import type { CriaClient, CriaCustody } from '@vela/cria'
import type { AcquisitionArchive, AcquisitionSource, ArchiveReceipt } from '../acquisitions/archive.js'

export interface CriaCustodyReport {
  acknowledged: number
  preserved: number
  problems: string[]
}

/**
 * Moves each Cria original into Vela's acquisition archive and returns the verified receipt to
 * Cria, which may then release its redundant copy. A failed transfer or archive is repaired by
 * fetching the same original again; this never requests another exposure.
 */
export function createCriaCustody(client: CriaClient, archive: AcquisitionArchive, storeId: string) {
  function source(record: CriaCustody): AcquisitionSource {
    const image = record.image!

    return {
      system: 'cria',
      storeId: record.storeId,
      imageId: record.id,
      operationId: record.operationId,
      requestId: record.requestId,
      sha256: image.sha256,
      bytes: image.original.bytes,
      mediaType: 'application/imagebytes',
    }
  }

  async function acknowledge(receipt: ArchiveReceipt) {
    const accepted = await client.acknowledgeArchive(receipt)

    await archive.acknowledged(receipt, accepted.state)
  }

  async function preserve(record: CriaCustody, original: Uint8Array, purpose: AcquisitionPurpose | undefined, preservedBy: 'acquisition' | 'recovery') {
    const receipt = await archive.preserve({
      source: source(record),
      original,
      context: {
        acquisition: {
          purpose: purpose ?? 'unrecorded',
          preservedBy,
          preservedAt: new Date().toISOString(),
        },
        cria: {
          identities: {
            instanceId: record.instanceId,
            deviceId: record.deviceId,
            bindingId: record.bindingId,
            cameraName: record.cameraName,
            reservedAt: record.reservedAt,
          },
          image: record.image,
          context: record.context,
        },
      },
    })

    await acknowledge(receipt)
  }

  let recovering: Promise<CriaCustodyReport> | undefined
  // Originals an in-flight acquisition will preserve with its own purpose.
  const claimed = new Set<string>()

  async function recoverOnce(): Promise<CriaCustodyReport> {
    const report: CriaCustodyReport = { acknowledged: 0, preserved: 0, problems: [] }
    const local = await archive.unacknowledged()

    report.problems.push(...local.problems)

    for (const receipt of local.receipts) {
      if (receipt.storeId !== storeId) continue

      try {
        await acknowledge(receipt)
        report.acknowledged++
      } catch (error) {
        report.problems.push(`${receipt.imageId}: ${error instanceof Error ? error.message : 'acknowledgement failed'}`)
      }
    }

    for (let after = 0; ;) {
      const page = await client.retainedOriginals(after)

      for (const record of page.images) {
        if (claimed.has(record.id)) continue

        try {
          const receipt = await archive.receipt(record.storeId, record.id)

          if (receipt) await acknowledge(receipt)
          else await preserve(record, await client.originalOf(record), undefined, 'recovery')
          report.preserved++
        } catch (error) {
          report.problems.push(`${record.id}: ${error instanceof Error ? error.message : 'preservation failed'}`)
        }
      }

      if (page.images.length < 50) break
      after = page.next
    }

    return report
  }

  return {
    claim(imageId: string) {
      claimed.add(imageId)
    },
    unclaim(imageId: string) {
      claimed.delete(imageId)
    },
    /** Preserve a just-acquired original before any consumer processes its pixels. */
    async preserveAcquisition(imageId: string, original: Uint8Array, purpose: AcquisitionPurpose | undefined) {
      await preserve(await client.custody(imageId), original, purpose, 'acquisition')
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
