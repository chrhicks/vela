import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { CriaCustody, CriaImage } from '@vela/cria'
import { syncDirectory, writeDurable } from '../saved-images/durable-files.js'

/**
 * Where Vela keeps every acquired original, exactly as Cria delivered it, with an immutable
 * context manifest. Preservation is additive: it does not choose the permanent archive format
 * and it does not replace FITS export or Keep.
 *
 * <root>/<storeId>/<imageId>/
 *   original.imagebytes   exact source bytes
 *   context.json          immutable manifest; its SHA-256 is bound into the receipt
 *   receipt.json          written once, after both files are re-read and verified
 *   acknowledgement.json  Cria accepted the receipt
 */

const digest = z.string().regex(/^[a-f0-9]{64}$/)

export const AcquisitionSourceSchema = z.strictObject({
  system: z.literal('cria'),
  storeId: z.uuid(),
  imageId: z.uuid(),
  operationId: z.uuid(),
  requestId: z.string(),
  sha256: digest,
  bytes: z.number().int().min(44),
  mediaType: z.literal('application/imagebytes'),
})

export type AcquisitionSource = z.infer<typeof AcquisitionSourceSchema>

const manifestSchema = z.looseObject({ version: z.literal(1), source: AcquisitionSourceSchema })

export const ArchiveReceiptSchema = z.strictObject({
  receiptId: z.uuid(),
  storeId: z.uuid(),
  imageId: z.uuid(),
  operationId: z.uuid(),
  sha256: digest,
  bytes: z.number().int().min(44),
  archive: z.strictObject({
    system: z.literal('vela'),
    artifactId: z.string(),
    representation: z.literal('imagebytes'),
    sha256: digest,
    bytes: z.number().int().min(44),
    contextSha256: digest,
    verification: z.strictObject({ method: z.literal('sha256-reread'), verifiedAt: z.number().int().positive() }),
  }),
})

export type ArchiveReceipt = z.infer<typeof ArchiveReceiptSchema>

export class ArchiveConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveConflictError'
  }
}

/** Why and how an original was preserved, plus the source's own context, recorded once. */
export interface AcquisitionContext {
  acquisition: {
    purpose: string
    preservedBy: 'acquisition' | 'recovery'
    preservedAt: string
  }
  cria?: {
    identities: {
      instanceId: string
      deviceId: string
      bindingId: string
      cameraName: string
      reservedAt: number
    }
    image: CriaImage | null
    context: CriaCustody['context']
  }
}

export interface AcquisitionArchive {
  /** Publish, re-read and verify, then return the one receipt for this acquisition. Idempotent. */
  preserve(input: { source: AcquisitionSource; original: Uint8Array; context: AcquisitionContext }): Promise<ArchiveReceipt>
  /** Record that the source accepted the receipt. */
  acknowledged(receipt: ArchiveReceipt, sourceState: string): Promise<void>
  /** Receipts not yet acknowledged, each re-verified against the stored files. */
  unacknowledged(): Promise<{ receipts: ArchiveReceipt[]; problems: string[] }>
  /** The verified receipt of an already published acquisition, if any. */
  receipt(storeId: string, imageId: string): Promise<ArchiveReceipt | undefined>
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

function isFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function readOptional(path: string) {
  try {
    return await readFile(path)
  } catch (error) {
    if (isFileError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

export async function openAcquisitionArchive(root: string, openFile: typeof open = open): Promise<AcquisitionArchive> {
  await mkdir(root, { recursive: true })

  // An interrupted publication is Vela's own unverified copy; Cria still holds the original.
  for (const entry of await readdir(root))
    if (entry.startsWith('.staging-')) await rm(join(root, entry), { recursive: true, force: true })

  const directory = (storeId: string, imageId: string) => join(root, storeId, imageId)

  async function publish(source: AcquisitionSource, original: Uint8Array, context: AcquisitionContext) {
    const target = directory(source.storeId, source.imageId)

    if (await readOptional(join(target, 'context.json'))) return target

    const staging = await mkdtemp(join(root, '.staging-'))

    try {
      await writeDurable(join(staging, 'original.imagebytes'), Buffer.from(original), openFile)
      await writeDurable(join(staging, 'context.json'), JSON.stringify({ version: 1, ...context, source }, null, 2), openFile)
      await syncDirectory(staging)
      await mkdir(join(root, source.storeId), { recursive: true })
      await rename(staging, target)
      await syncDirectory(join(root, source.storeId))
    } catch (error) {
      await rm(staging, { recursive: true, force: true })

      // A concurrent preservation of the same acquisition won; verify that copy instead.
      if (!isFileError(error) || !['EEXIST', 'ENOTEMPTY'].includes(error.code ?? '')) throw error
    }

    return target
  }

  /** Re-read both files; any difference from the source identity is a conflict, never a repair. */
  async function verify(source: AcquisitionSource, target: string) {
    const original = await readOptional(join(target, 'original.imagebytes'))
    const contextBytes = await readOptional(join(target, 'context.json'))

    if (!original || !contextBytes) throw new ArchiveConflictError('Archived acquisition is incomplete')

    const manifest = manifestSchema.parse(JSON.parse(contextBytes.toString('utf8')))
    const stored = manifest.source

    if (stored.storeId !== source.storeId || stored.imageId !== source.imageId ||
      stored.operationId !== source.operationId || stored.sha256 !== source.sha256 || stored.bytes !== source.bytes)
      throw new ArchiveConflictError('Archived context names a different acquisition')

    if (original.byteLength !== source.bytes || sha256(original) !== source.sha256)
      throw new ArchiveConflictError('Archived original differs from the Cria source')

    return { contextSha256: sha256(contextBytes) }
  }

  async function receiptFor(source: AcquisitionSource, target: string): Promise<ArchiveReceipt> {
    const { contextSha256 } = await verify(source, target)
    const path = join(target, 'receipt.json')
    const existing = await readOptional(path)

    if (existing) {
      const receipt = ArchiveReceiptSchema.parse(JSON.parse(existing.toString('utf8')))

      if (receipt.imageId !== source.imageId || receipt.sha256 !== source.sha256 || receipt.archive.contextSha256 !== contextSha256)
        throw new ArchiveConflictError('Stored archive receipt does not match its verified files')

      return receipt
    }

    const receipt: ArchiveReceipt = {
      receiptId: randomUUID(),
      storeId: source.storeId,
      imageId: source.imageId,
      operationId: source.operationId,
      sha256: source.sha256,
      bytes: source.bytes,
      archive: {
        system: 'vela',
        artifactId: `${source.storeId}/${source.imageId}`,
        representation: 'imagebytes',
        sha256: source.sha256,
        bytes: source.bytes,
        contextSha256,
        verification: { method: 'sha256-reread', verifiedAt: Date.now() },
      },
    }

    try {
      await writeDurable(path, JSON.stringify(receipt, null, 2), openFile)
      await syncDirectory(target)
    } catch (error) {
      // Another preservation recorded the receipt first; that one is authoritative.
      if (!isFileError(error) || error.code !== 'EEXIST') throw error

      return receiptFor(source, target)
    }

    return receipt
  }

  return {
    async preserve({ source, original, context }) {
      const validated = AcquisitionSourceSchema.parse(source)

      if (original.byteLength !== validated.bytes || sha256(original) !== validated.sha256)
        throw new ArchiveConflictError('Original bytes do not match their Cria source digest')

      return receiptFor(validated, await publish(validated, original, context))
    },
    async acknowledged(receipt, sourceState) {
      const target = directory(receipt.storeId, receipt.imageId)

      try {
        await writeDurable(join(target, 'acknowledgement.json'), JSON.stringify({
          receiptId: receipt.receiptId,
          sourceState,
          acknowledgedAt: new Date().toISOString(),
        }, null, 2), openFile)
        await syncDirectory(target)
      } catch (error) {
        if (!isFileError(error) || error.code !== 'EEXIST') throw error
      }
    },
    async unacknowledged() {
      const receipts: ArchiveReceipt[] = []
      const problems: string[] = []

      for (const storeId of await readdir(root)) {
        if (storeId.startsWith('.')) continue

        for (const imageId of await readdir(join(root, storeId))) {
          const target = directory(storeId, imageId)

          if (await readOptional(join(target, 'acknowledgement.json'))) continue

          try {
            const contextBytes = await readOptional(join(target, 'context.json'))

            if (!contextBytes) throw new ArchiveConflictError('Archived acquisition has no context')
            const { source } = manifestSchema.parse(JSON.parse(contextBytes.toString('utf8')))

            receipts.push(await receiptFor(source, target))
          } catch (error) {
            problems.push(`${storeId}/${imageId}: ${error instanceof Error ? error.message : 'unreadable'}`)
          }
        }
      }

      return { receipts, problems }
    },
    async receipt(storeId, imageId) {
      const target = directory(storeId, imageId)
      const contextBytes = await readOptional(join(target, 'context.json'))

      if (!contextBytes) return undefined

      return receiptFor(manifestSchema.parse(JSON.parse(contextBytes.toString('utf8'))).source, target)
    },
  }
}

/** Same contract without durability, for tests and composition without a configured archive. */
export function createMemoryAcquisitionArchive(): AcquisitionArchive {
  const entries = new Map<string, {
    source: AcquisitionSource
    original: Buffer
    context: Buffer
    receipt?: ArchiveReceipt
    acknowledged?: string
  }>()

  function receiptFor(key: string): ArchiveReceipt {
    const entry = entries.get(key)!

    if (entry.original.byteLength !== entry.source.bytes || sha256(entry.original) !== entry.source.sha256)
      throw new ArchiveConflictError('Archived original differs from the Cria source')

    entry.receipt ??= {
      receiptId: randomUUID(),
      storeId: entry.source.storeId,
      imageId: entry.source.imageId,
      operationId: entry.source.operationId,
      sha256: entry.source.sha256,
      bytes: entry.source.bytes,
      archive: {
        system: 'vela',
        artifactId: key,
        representation: 'imagebytes',
        sha256: entry.source.sha256,
        bytes: entry.source.bytes,
        contextSha256: sha256(entry.context),
        verification: { method: 'sha256-reread', verifiedAt: Date.now() },
      },
    }

    return entry.receipt
  }

  return {
    async preserve({ source, original, context }) {
      const validated = AcquisitionSourceSchema.parse(source)
      const key = `${validated.storeId}/${validated.imageId}`

      if (original.byteLength !== validated.bytes || sha256(original) !== validated.sha256)
        throw new ArchiveConflictError('Original bytes do not match their Cria source digest')

      if (!entries.has(key)) {
        entries.set(key, {
          source: validated,
          original: Buffer.from(original),
          context: Buffer.from(JSON.stringify({ version: 1, ...context, source: validated })),
        })
      }

      return receiptFor(key)
    },
    async acknowledged(receipt, sourceState) {
      const entry = entries.get(`${receipt.storeId}/${receipt.imageId}`)

      if (entry) entry.acknowledged = sourceState
    },
    async unacknowledged() {
      const receipts: ArchiveReceipt[] = []

      for (const [key, entry] of entries) if (!entry.acknowledged) receipts.push(receiptFor(key))

      return { receipts, problems: [] }
    },
    async receipt(storeId, imageId) {
      return entries.has(`${storeId}/${imageId}`) ? receiptFor(`${storeId}/${imageId}`) : undefined
    },
  }
}
