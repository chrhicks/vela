import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { CriaImageSchema, CriaReadingSchema } from '@vela/cria'
import { syncDirectory, writeDurable } from '../saved-images/durable-files.js'

/**
 * Where Vela keeps every acquired original, exactly as Cria delivered it, with an immutable
 * context manifest. Preservation is additive: it does not choose the permanent archive format
 * and it does not replace FITS export or Keep.
 *
 * <root>/<storeId>/
 *   .intents/<requestId>.json  Vela's acquisition intent, written before the request is sent
 *   <imageId>/
 *     original.imagebytes      exact source bytes
 *     context.json             complete manifest, checked against expected context before a receipt
 *     receipt.json             written once; binds the original and manifest digests
 *     acknowledgement.json     Cria accepted that receipt
 */

const digest = z.string().regex(/^[a-f0-9]{64}$/)

/** Records are compared by content, not by the order Cria happened to emit their keys. */
function sortedEntries<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

const jsonObject = z.record(z.string(), z.json()).transform(sortedEntries)

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

export const AcquisitionPurposeSchema = z.enum(['capture', 'autofocus', 'framing', 'alignment'])

/** What Vela knew about an exposure before asking Cria for it. Cria cannot reconstruct this. */
export const AcquisitionIntentSchema = z.strictObject({
  version: z.literal(1),
  storeId: z.uuid(),
  requestId: z.string().min(1),
  rigId: z.string().min(1),
  deviceId: z.string().min(1),
  expectedCameraName: z.string().nullable(),
  purpose: AcquisitionPurposeSchema.nullable(),
  exposureSeconds: z.number().positive(),
  recordedAt: z.iso.datetime(),
})

export type AcquisitionIntent = z.infer<typeof AcquisitionIntentSchema>

/**
 * Cria's acquisition context, version 1. Ordinary records carry the requested parameters and
 * labelled camera observations; records Cria migrated name their source instead, so the
 * missing observations are explicit rather than silently absent.
 */
const CriaContextSchema = z.union([
  z.strictObject({
    version: z.literal(1),
    requested: jsonObject,
    cameraObservations: z.record(z.string(), CriaReadingSchema).transform(sortedEntries),
    observationsNote: z.string(),
  }),
  z.strictObject({
    version: z.literal(1),
    migratedFrom: z.string().min(1),
    requested: jsonObject.optional(),
  }),
])

const acquisitionFields = {
  source: AcquisitionSourceSchema,
  cria: z.strictObject({
    identities: z.strictObject({
      instanceId: z.string(),
      deviceId: z.string(),
      bindingId: z.string(),
      cameraName: z.string(),
      reservedAt: z.number().int().nonnegative(),
    }),
    image: CriaImageSchema,
    context: CriaContextSchema,
  }),
  /** Null when no Vela intent was recorded for this request; its purpose is then unknown. */
  intent: AcquisitionIntentSchema.nullable(),
}

type ExpectedFields = z.infer<z.ZodObject<typeof acquisitionFields>>

function checkIdentities(value: ExpectedFields, context: z.RefinementCtx) {
  const { source, cria, intent } = value
  const image = cria.image

  if (image.id !== source.imageId || image.operationId !== source.operationId ||
    image.sha256 !== source.sha256 || image.original.bytes !== source.bytes ||
    image.bindingId !== cria.identities.bindingId || image.deviceId !== cria.identities.deviceId ||
    image.instanceId !== cria.identities.instanceId || image.cameraName !== cria.identities.cameraName)
    context.addIssue({ code: 'custom', message: 'Acquisition identities disagree with the source' })

  if (intent && (intent.storeId !== source.storeId || intent.requestId !== source.requestId ||
    intent.deviceId !== cria.identities.deviceId))
    context.addIssue({ code: 'custom', message: 'Acquisition intent names another request or device' })
}

/** Everything about the acquisition that must match before Vela vouches for it. */
export const ExpectedAcquisitionSchema = z.strictObject(acquisitionFields).superRefine(checkIdentities)

export type ExpectedAcquisition = z.infer<typeof ExpectedAcquisitionSchema>

const ManifestSchema = z.strictObject({
  version: z.literal(1),
  ...acquisitionFields,
  preservation: z.strictObject({
    by: z.enum(['acquisition', 'recovery']),
    at: z.iso.datetime(),
  }),
}).superRefine(checkIdentities)

export type AcquisitionManifest = z.infer<typeof ManifestSchema>

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

export interface AcquisitionArchive {
  /** Durably record intent before the request is sent, so it survives a lost response or restart. */
  recordIntent(intent: AcquisitionIntent): Promise<void>
  intent(storeId: string, requestId: string): Promise<AcquisitionIntent | undefined>
  /**
   * Publish if absent, re-read, check the stored manifest equals the expected acquisition, then
   * return the one receipt for it. Idempotent; a stored copy that differs is a conflict.
   */
  preserve(input: {
    expected: ExpectedAcquisition
    original: Uint8Array
    preservedBy: 'acquisition' | 'recovery'
  }): Promise<ArchiveReceipt>
  /** The receipt of an already published acquisition, checked against the expected acquisition. */
  receipt(expected: ExpectedAcquisition): Promise<ArchiveReceipt | undefined>
  /** Record that the source accepted the receipt. */
  acknowledged(receipt: ArchiveReceipt, sourceState: string): Promise<void>
  /**
   * Work left for one store: re-verified receipts not yet acknowledged, and published
   * acquisitions with no receipt, which need expected context before one can be issued.
   */
  unacknowledged(storeId: string): Promise<{ receipts: ArchiveReceipt[]; unreceipted: string[]; problems: string[] }>
  /** Verified original bytes of an acquisition that already has a receipt. */
  original(storeId: string, imageId: string): Promise<Uint8Array | undefined>
}

/** Filesystem operations whose order makes publication durable. Injectable to test that order. */
export interface ArchiveFileSystem {
  open: typeof open
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  syncDirectory(path: string): Promise<void>
}

export const nodeArchiveFileSystem: ArchiveFileSystem = {
  open,
  mkdir: async path => {
    await mkdir(path)
  },
  rename,
  syncDirectory,
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

async function exists(path: string) {
  try {
    await stat(path)

    return true
  } catch (error) {
    if (isFileError(error) && error.code === 'ENOENT') return false
    throw error
  }
}

/**
 * Both sides pass through the same schemas, which emit fields in schema order, so equal
 * acquisitions serialize identically. Reordered or extra content compares unequal: a conflict.
 */
function manifestMatches(manifest: AcquisitionManifest, expected: ExpectedAcquisition) {
  const { source, cria, intent } = manifest

  return JSON.stringify(ExpectedAcquisitionSchema.parse({ source, cria, intent })) ===
    JSON.stringify(ExpectedAcquisitionSchema.parse(expected))
}

export async function openAcquisitionArchive(
  root: string,
  fs: ArchiveFileSystem = nodeArchiveFileSystem,
): Promise<AcquisitionArchive> {
  /**
   * Create each missing directory and sync its parent, so its own name is durable too. The final
   * directory's parent is synced even when it already existed: an earlier attempt may have been
   * interrupted between creating it and syncing its parent.
   */
  async function ensureDirectory(path: string) {
    const missing: string[] = []
    const final = resolve(path)

    for (let current = final; !(await exists(current)); current = dirname(current))
      missing.unshift(current)

    for (const created of missing) {
      try {
        await fs.mkdir(created)
      } catch (error) {
        if (!isFileError(error) || error.code !== 'EEXIST') throw error
      }

      await fs.syncDirectory(dirname(created))
    }

    if (missing.length === 0) await fs.syncDirectory(dirname(final))
  }

  await ensureDirectory(root)

  // An interrupted publication is Vela's own unverified copy; Cria still holds the original.
  for (const entry of await readdir(root))
    if (entry.startsWith('.staging-')) await rm(join(root, entry), { recursive: true, force: true })

  const directory = (storeId: string, imageId: string) => join(root, storeId, imageId)

  const intentPath = (storeId: string, requestId: string) =>
    join(root, storeId, '.intents', `${encodeURIComponent(requestId)}.json`)

  // One writer per acquisition in this process; Vela runs a single server per archive.
  const writers = new Map<string, Promise<unknown>>()

  function exclusive<T>(target: string, work: () => Promise<T>): Promise<T> {
    const next = (writers.get(target) ?? Promise.resolve()).catch(() => {}).then(work)

    writers.set(target, next)
    void next.finally(() => { if (writers.get(target) === next) writers.delete(target) }).catch(() => {})

    return next
  }

  /**
   * A small record appears under its final name only once complete and synced. An existing one
   * may have been renamed just before an interruption, so its directory is synced again too.
   */
  async function publishOnce(path: string, data: string) {
    if (await readOptional(path)) {
      await fs.syncDirectory(dirname(path))

      return
    }

    const temporary = `${path}.${randomUUID()}.new`

    try {
      await writeDurable(temporary, data, fs.open)
      await fs.rename(temporary, path)
      await fs.syncDirectory(dirname(path))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async function publish(expected: ExpectedAcquisition, original: Uint8Array, preservedBy: 'acquisition' | 'recovery') {
    const { source } = expected
    const target = directory(source.storeId, source.imageId)

    if (await readOptional(join(target, 'context.json'))) {
      // Published earlier, possibly just before an interruption: make its path durable again.
      await ensureDirectory(join(root, source.storeId))
      await fs.syncDirectory(join(root, source.storeId))

      return target
    }

    const manifest: AcquisitionManifest = {
      version: 1,
      ...expected,
      preservation: { by: preservedBy, at: new Date().toISOString() },
    }

    const staging = await mkdtemp(join(root, '.staging-'))

    try {
      await writeDurable(join(staging, 'original.imagebytes'), Buffer.from(original), fs.open)
      await writeDurable(join(staging, 'context.json'), JSON.stringify(manifest, null, 2), fs.open)
      await fs.syncDirectory(staging)
      await ensureDirectory(join(root, source.storeId))
      await fs.rename(staging, target)
      await fs.syncDirectory(join(root, source.storeId))
    } catch (error) {
      await rm(staging, { recursive: true, force: true })

      // A concurrent preservation of the same acquisition won; verify that copy instead.
      if (!isFileError(error) || !['EEXIST', 'ENOTEMPTY'].includes(error.code ?? '')) throw error
    }

    return target
  }

  /**
   * Re-read the stored files. The original must match its source digest and the manifest must be
   * complete and internally consistent. Differences are conflicts, never repaired.
   */
  async function stored(target: string) {
    const original = await readOptional(join(target, 'original.imagebytes'))
    const contextBytes = await readOptional(join(target, 'context.json'))

    if (!original || !contextBytes) throw new ArchiveConflictError('Archived acquisition is incomplete')

    let parsed: ReturnType<typeof ManifestSchema.safeParse>

    try {
      parsed = ManifestSchema.safeParse(JSON.parse(contextBytes.toString('utf8')))
    } catch {
      throw new ArchiveConflictError('Archived context is unreadable')
    }

    if (!parsed.success) throw new ArchiveConflictError('Archived context is incomplete or inconsistent')
    const manifest = parsed.data

    if (original.byteLength !== manifest.source.bytes || sha256(original) !== manifest.source.sha256)
      throw new ArchiveConflictError('Archived original differs from the Cria source')

    return { manifest, original, contextSha256: sha256(contextBytes) }
  }

  async function existingReceipt(target: string, files: Awaited<ReturnType<typeof stored>>) {
    const bytes = await readOptional(join(target, 'receipt.json'))

    if (!bytes) return undefined
    const receipt = ArchiveReceiptSchema.parse(JSON.parse(bytes.toString('utf8')))
    const { source } = files.manifest

    // A receipt binds the bytes and manifest it was issued for; they can never change afterwards.
    if (receipt.imageId !== source.imageId || receipt.storeId !== source.storeId ||
      receipt.operationId !== source.operationId || receipt.sha256 !== source.sha256 ||
      receipt.archive.contextSha256 !== files.contextSha256)
      throw new ArchiveConflictError('Stored archive receipt does not match its files')

    // It may have been renamed into place just before an interruption; sync before handing it out.
    await fs.syncDirectory(target)

    return receipt
  }

  async function receiptFor(expected: ExpectedAcquisition, target: string): Promise<ArchiveReceipt> {
    const files = await stored(target)

    if (!manifestMatches(files.manifest, expected))
      throw new ArchiveConflictError('Archived context differs from the expected acquisition context')

    const existing = await existingReceipt(target, files)

    if (existing) return existing

    const { source } = expected

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
        contextSha256: files.contextSha256,
        verification: { method: 'sha256-reread', verifiedAt: Date.now() },
      },
    }

    await publishOnce(join(target, 'receipt.json'), JSON.stringify(receipt, null, 2))

    return receipt
  }

  return {
    async recordIntent(intent) {
      const validated = AcquisitionIntentSchema.parse(intent)
      const path = intentPath(validated.storeId, validated.requestId)

      await ensureDirectory(dirname(path))
      await publishOnce(path, JSON.stringify(validated, null, 2))
    },
    async intent(storeId, requestId) {
      const bytes = await readOptional(intentPath(storeId, requestId))

      return bytes && AcquisitionIntentSchema.parse(JSON.parse(bytes.toString('utf8')))
    },
    async preserve({ expected, original, preservedBy }) {
      const validated = ExpectedAcquisitionSchema.parse(expected)

      if (original.byteLength !== validated.source.bytes || sha256(original) !== validated.source.sha256)
        throw new ArchiveConflictError('Original bytes do not match their Cria source digest')

      const target = await publish(validated, original, preservedBy)

      return exclusive(target, () => receiptFor(validated, target))
    },
    async receipt(expected) {
      const validated = ExpectedAcquisitionSchema.parse(expected)
      const target = directory(validated.source.storeId, validated.source.imageId)

      if (!await readOptional(join(target, 'context.json'))) return undefined

      return exclusive(target, async () => {
        await ensureDirectory(join(root, validated.source.storeId))
        await fs.syncDirectory(join(root, validated.source.storeId))

        return receiptFor(validated, target)
      })
    },
    async acknowledged(receipt, sourceState) {
      const target = directory(receipt.storeId, receipt.imageId)

      await exclusive(target, () => publishOnce(join(target, 'acknowledgement.json'), JSON.stringify({
        receiptId: receipt.receiptId,
        sourceState,
        acknowledgedAt: new Date().toISOString(),
      }, null, 2)))
    },
    async unacknowledged(storeId) {
      const receipts: ArchiveReceipt[] = []
      const unreceipted: string[] = []
      const problems: string[] = []

      if (!await exists(join(root, storeId))) return { receipts, unreceipted, problems }

      // Receipts listed here may be sent; re-link the store path in case of an earlier interruption.
      await ensureDirectory(join(root, storeId))
      await fs.syncDirectory(join(root, storeId))

      for (const imageId of await readdir(join(root, storeId))) {
        if (imageId.startsWith('.')) continue
        const target = directory(storeId, imageId)

        if (await readOptional(join(target, 'acknowledgement.json'))) continue

        try {
          const files = await stored(target)
          const receipt = await existingReceipt(target, files)

          if (receipt) receipts.push(receipt)
          else unreceipted.push(imageId)
        } catch (error) {
          problems.push(`${storeId}/${imageId}: ${error instanceof Error ? error.message : 'unreadable'}`)
        }
      }

      return { receipts, unreceipted, problems }
    },
    async original(storeId, imageId) {
      const target = directory(storeId, imageId)

      if (!await readOptional(join(target, 'receipt.json'))) return undefined
      const files = await stored(target)

      return (await existingReceipt(target, files)) && new Uint8Array(files.original)
    },
  }
}

/** Same contract without durability. Test-only: Cria rigs are never composed without a durable archive. */
export function createMemoryAcquisitionArchive(): AcquisitionArchive {
  const intents = new Map<string, AcquisitionIntent>()

  const entries = new Map<string, {
    manifest: AcquisitionManifest
    original: Buffer
    receipt?: ArchiveReceipt
    acknowledged?: string
  }>()

  function receiptFor(expected: ExpectedAcquisition): ArchiveReceipt {
    const key = `${expected.source.storeId}/${expected.source.imageId}`
    const entry = entries.get(key)!

    if (!manifestMatches(entry.manifest, expected))
      throw new ArchiveConflictError('Archived context differs from the expected acquisition context')

    entry.receipt ??= {
      receiptId: randomUUID(),
      storeId: expected.source.storeId,
      imageId: expected.source.imageId,
      operationId: expected.source.operationId,
      sha256: expected.source.sha256,
      bytes: expected.source.bytes,
      archive: {
        system: 'vela',
        artifactId: key,
        representation: 'imagebytes',
        sha256: expected.source.sha256,
        bytes: expected.source.bytes,
        contextSha256: sha256(Buffer.from(JSON.stringify(entry.manifest))),
        verification: { method: 'sha256-reread', verifiedAt: Date.now() },
      },
    }

    return entry.receipt
  }

  return {
    async recordIntent(intent) {
      const validated = AcquisitionIntentSchema.parse(intent)

      intents.set(`${validated.storeId}/${validated.requestId}`, validated)
    },
    async intent(storeId, requestId) {
      return intents.get(`${storeId}/${requestId}`)
    },
    async preserve({ expected, original, preservedBy }) {
      const validated = ExpectedAcquisitionSchema.parse(expected)
      const key = `${validated.source.storeId}/${validated.source.imageId}`

      if (original.byteLength !== validated.source.bytes || sha256(original) !== validated.source.sha256)
        throw new ArchiveConflictError('Original bytes do not match their Cria source digest')

      if (!entries.has(key)) {
        entries.set(key, {
          manifest: { version: 1, ...validated, preservation: { by: preservedBy, at: new Date().toISOString() } },
          original: Buffer.from(original),
        })
      }

      return receiptFor(validated)
    },
    async receipt(expected) {
      const validated = ExpectedAcquisitionSchema.parse(expected)

      return entries.has(`${validated.source.storeId}/${validated.source.imageId}`) ? receiptFor(validated) : undefined
    },
    async acknowledged(receipt, sourceState) {
      const entry = entries.get(`${receipt.storeId}/${receipt.imageId}`)

      if (entry) entry.acknowledged = sourceState
    },
    async unacknowledged(storeId) {
      const receipts: ArchiveReceipt[] = []
      const unreceipted: string[] = []

      for (const entry of entries.values()) {
        if (entry.manifest.source.storeId !== storeId || entry.acknowledged) continue

        if (entry.receipt) receipts.push(entry.receipt)
        else unreceipted.push(entry.manifest.source.imageId)
      }

      return { receipts, unreceipted, problems: [] }
    },
    async original(storeId, imageId) {
      const entry = entries.get(`${storeId}/${imageId}`)

      return entry?.receipt && new Uint8Array(entry.original)
    },
  }
}
