import { createHash, randomUUID } from 'node:crypto'
import { access, constants, link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, statfs } from 'node:fs/promises'
import { closeSync, openSync, type Stats } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { dirname, join, parse, resolve } from 'node:path'
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

/** Which stored or delivered fact disagrees with the acquisition Vela can vouch for. */
export type ArchiveConflictSubject = 'original' | 'context' | 'receipt'

export class ArchiveConflictError extends Error {
  constructor(message: string, readonly subject: ArchiveConflictSubject) {
    super(message)
    this.name = 'ArchiveConflictError'
  }
}

/**
 * The configured path no longer leads to the directory Vela opened (missing, or another folder
 * such as an empty mount point). The archive refuses to change or hand out receipts until it is
 * back in place, so Cria keeps its originals meanwhile.
 */
export class ArchiveDisplacedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveDisplacedError'
  }
}

/** Another live process, or another open instance in this process, already owns the archive. */
export class ArchiveOwnedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveOwnedError'
  }
}

export interface ArchiveTally {
  count: number
  bytes: number
}

/**
 * What the archive holds for one store, from directory listings and file sizes only. Nothing is
 * re-read or hashed here: integrity is verified when a receipt is issued or handed out.
 */
export interface ArchiveCensus {
  /** Verified, receipted and acknowledged by Cria. */
  preserved: ArchiveTally & { imageIds: string[] }
  /** Verified and receipted; Cria has not confirmed the receipt. */
  acknowledgementPending: ArchiveTally & { imageIds: string[] }
  /** Copied but not yet verified: no receipt has been issued. */
  unverified: ArchiveTally & { imageIds: string[] }
  /** Entries whose original file is gone; never counted as preserved. */
  damaged: { count: number; imageIds: string[] }
}

/**
 * Read-only health of the archive location. `location` compares the configured path with the
 * directory Vela opened: an unmounted disk can leave the path missing, or leave an empty mount
 * point on another filesystem in its place, which must not read as a healthy archive.
 */
export interface ArchiveStatus {
  root: string
  location: 'opened' | 'missing' | 'replaced'
  /** Whether this process may write there now; a full disk is only found by writing. */
  writable: boolean
  /** Free space of the opened archive's filesystem, or an estimate measured elsewhere. */
  space: { freeBytes: number; totalBytes: number; measuredPath: string; basis: 'opened-archive' | 'other-location' } | null
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
  unacknowledged(storeId: string): Promise<{
    receipts: ArchiveReceipt[]
    unreceipted: string[]
    problems: string[]
    /** The same problems, for stored copies that conflict with what they record. */
    damaged: Array<{ imageId: string; subject: ArchiveConflictSubject; message: string }>
  }>
  /** Verified original bytes of an acquisition that already has a receipt. */
  original(storeId: string, imageId: string): Promise<Uint8Array | undefined>
  /** Finish in-flight writes and give up ownership. Later calls fail; reopening is allowed. */
  close(): Promise<void>
  /** The receipt already written for an acquisition, if any. Read-only: never issues one. */
  issuedReceipt(storeId: string, imageId: string): Promise<ArchiveReceipt | undefined>
  /** Read-only location and space for health views: a few system calls, whatever the archive size. */
  status(): Promise<ArchiveStatus>
  /**
   * Read-only listing of every acquisition in one store, from file metadata only. Its cost grows with
   * the archive, so health views run it in the background and reuse the result.
   */
  census(storeId: string): Promise<ArchiveCensus>
}

/** Filesystem operations whose order makes publication durable. Injectable to test that order. */
export interface ArchiveFileSystem {
  open: typeof open
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** Hard link that fails with EEXIST rather than replacing an existing name. */
  link(existing: string, created: string): Promise<void>
  syncDirectory(path: string): Promise<void>
}

export const nodeArchiveFileSystem: ArchiveFileSystem = {
  open,
  mkdir: async path => {
    await mkdir(path)
  },
  rename,
  link,
  syncDirectory,
}

/**
 * One owner per archive path on this host and network namespace. A Linux abstract-namespace socket
 * named after the archive's canonical real path is held by exactly one live socket; the kernel
 * releases it when its process exits or crashes, so there is no stale lock to clear and nothing to
 * take over from a slow but live owner. A second open, in this process or another, fails before it
 * can clean up or write anything. Separate network namespaces, other hosts and other mount paths
 * are outside this guarantee.
 */
async function acquireOwnership(root: string, opened: string): Promise<() => Promise<void>> {
  if (process.platform !== 'linux')
    throw new ArchiveOwnedError('The acquisition archive ownership guard requires Linux; refusing to open the archive without it')

  const name = `\0vela-acquisition-archive/${createHash('sha256').update(await realpath(opened)).digest('hex')}`
  const owner = JSON.stringify({ pid: process.pid, openedAt: new Date().toISOString() })
  const server = createServer(socket => socket.end(owner))

  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen({ path: name, exclusive: true }, () => resolveListen())
    })
  } catch (error) {
    if (!isFileError(error) || error.code !== 'EADDRINUSE') throw error

    const holder = await new Promise<string>(resolveHolder => {
      const socket = createConnection({ path: name })
      let reply = ''

      socket.setTimeout(500, () => socket.destroy())
      socket.on('data', chunk => { reply += String(chunk) })
      socket.on('close', () => resolveHolder(reply))
      socket.on('error', () => resolveHolder(reply))
    })

    throw new ArchiveOwnedError(`Acquisition archive ${root} is already owned by ${holder || 'another live Vela process'}; refusing to open it twice`)
  }

  server.unref()

  return () => new Promise<void>(resolveClose => server.close(() => resolveClose()))
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
   * Make `path` exist with every directory link below `anchor` durable. Existence is not proof: an
   * earlier attempt may have created a component and been interrupted before syncing its parent.
   * So the parent of every component below the anchor is synced on every call.
   */
  async function ensureDirectory(path: string, anchor: string) {
    const final = resolve(path)
    const top = resolve(anchor)
    const missing: string[] = []

    for (let current = final; current !== top && !(await exists(current)); current = dirname(current))
      missing.unshift(current)

    for (const created of missing) {
      try {
        await fs.mkdir(created)
      } catch (error) {
        if (!isFileError(error) || error.code !== 'EEXIST') throw error
      }
    }

    for (let current = final; current !== top && current !== dirname(current); current = dirname(current))
      await fs.syncDirectory(dirname(current))
  }

  // The root's whole ancestry, up to the filesystem root, may include directories this or an
  // interrupted earlier start created. After this the root is never created again.
  await ensureDirectory(root, parse(resolve(root)).root)

  // Every archive file is reached through this descriptor, never by resolving `root` again, so
  // writes land in the directory opened here even if the path is later moved, deleted or mounted
  // over. It is a plain descriptor, not a FileHandle, because it lives as long as the archive.
  const descriptor = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY)
  const base = `/proc/self/fd/${descriptor}`

  let opened: Stats
  let releaseOwnership: () => Promise<void>

  try {
    opened = await stat(base)
    releaseOwnership = await acquireOwnership(root, base)
  } catch (error) {
    closeSync(descriptor)
    throw error
  }

  let closed = false

  // Only the owner gets here. An interrupted publication is then Vela's own unverified copy from a
  // process that has exited; Cria still holds the original.
  try {
    for (const entry of await readdir(base))
      if (entry.startsWith('.staging-')) await rm(join(base, entry), { recursive: true, force: true })
  } catch (error) {
    await releaseOwnership()
    closeSync(descriptor)
    throw error
  }

  // Every path goes through the descriptor, so close() waits for each operation started before it,
  // then gives up ownership and only then releases the descriptor.
  const inflight = new Set<Promise<unknown>>()

  function operation<T>(work: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new ArchiveOwnedError('Acquisition archive is closed; this process no longer owns it'))

    const running = work()

    inflight.add(running)
    void running.finally(() => inflight.delete(running)).catch(() => {})

    return running
  }

  /** Where the configured path leads now, compared with the directory opened above. */
  async function location(): Promise<ArchiveStatus['location']> {
    const current = await stat(root).catch(error => {
      if (isFileError(error) && error.code === 'ENOENT') return undefined
      throw error
    })

    return !current ? 'missing' : current.dev === opened.dev && current.ino === opened.ino ? 'opened' : 'replaced'
  }

  /**
   * The archive changes, and receipts leave it, only while its configured path still leads to the
   * directory Vela opened: the fact `status()` reports. Otherwise Cria keeps its originals.
   */
  async function assertInPlace() {
    const where = await location()

    if (where === 'missing')
      throw new ArchiveDisplacedError('The archive folder Vela opened is no longer at its path; originals stay at Cria')

    if (where === 'replaced')
      throw new ArchiveDisplacedError('The archive path now leads to a different folder than the one Vela opened; originals stay at Cria')
  }

  const directory = (storeId: string, imageId: string) => join(base, storeId, imageId)

  const intentPath = (storeId: string, requestId: string) =>
    join(base, storeId, '.intents', `${encodeURIComponent(requestId)}.json`)

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

      try {
        // Never replace a record another writer already published; the first one stays.
        await fs.link(temporary, path)
      } catch (error) {
        if (!isFileError(error) || error.code === 'EEXIST') throw error

        // Filesystems without hard links (for example exFAT): rename, relying on ownership.
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(error.code ?? '')) throw error
        await fs.rename(temporary, path)
      }

      await fs.syncDirectory(dirname(path))
    } catch (error) {
      if (!isFileError(error) || error.code !== 'EEXIST') throw error
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
      await ensureDirectory(join(base, source.storeId), base)
      await fs.syncDirectory(join(base, source.storeId))

      return target
    }

    const manifest: AcquisitionManifest = {
      version: 1,
      ...expected,
      preservation: { by: preservedBy, at: new Date().toISOString() },
    }

    const staging = await mkdtemp(join(base, '.staging-'))

    try {
      await writeDurable(join(staging, 'original.imagebytes'), Buffer.from(original), fs.open)
      await writeDurable(join(staging, 'context.json'), JSON.stringify(manifest, null, 2), fs.open)
      await fs.syncDirectory(staging)
      await ensureDirectory(join(base, source.storeId), base)
      await fs.rename(staging, target)
      await fs.syncDirectory(join(base, source.storeId))
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

    if (!original || !contextBytes) throw new ArchiveConflictError('Archived acquisition is incomplete', 'original')

    let parsed: ReturnType<typeof ManifestSchema.safeParse>

    try {
      parsed = ManifestSchema.safeParse(JSON.parse(contextBytes.toString('utf8')))
    } catch {
      throw new ArchiveConflictError('Archived context is unreadable', 'context')
    }

    if (!parsed.success) throw new ArchiveConflictError('Archived context is incomplete or inconsistent', 'context')
    const manifest = parsed.data

    if (original.byteLength !== manifest.source.bytes || sha256(original) !== manifest.source.sha256)
      throw new ArchiveConflictError('Archived original differs from the Cria source', 'original')

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
      throw new ArchiveConflictError('Stored archive receipt does not match its files', 'receipt')

    // It may have been renamed into place just before an interruption; sync before handing it out.
    await fs.syncDirectory(target)

    return receipt
  }

  async function receiptFor(expected: ExpectedAcquisition, target: string): Promise<ArchiveReceipt> {
    const files = await stored(target)

    if (!manifestMatches(files.manifest, expected))
      throw new ArchiveConflictError('Archived context differs from the expected acquisition context', 'context')

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

    // Return what is stored, so every caller gets the one receipt recovery can resend.
    const published = await existingReceipt(target, files)

    if (!published) throw new ArchiveConflictError('Archive receipt was not published', 'receipt')

    return published
  }

  async function archiveStatus(): Promise<ArchiveStatus> {
    const where = await location()
    const writable = where === 'opened' && await access(root, constants.W_OK).then(() => true, () => false)

    return { root, location: where, writable, space: await space(where) }
  }

  /** Measure the archive's filesystem; if its path is gone, the nearest existing ancestor, labelled. */
  async function space(location: ArchiveStatus['location']): Promise<ArchiveStatus['space']> {
    for (let path = root; ; path = dirname(path)) {
      const measured = await statfs(path).catch(() => undefined)

      if (measured) {
        return {
          freeBytes: measured.bavail * measured.bsize,
          totalBytes: measured.blocks * measured.bsize,
          measuredPath: path,
          basis: location === 'opened' && path === root ? 'opened-archive' : 'other-location',
        }
      }

      if (path === dirname(path)) return null
    }
  }

  async function census(storeId: string): Promise<ArchiveCensus> {
    const result: ArchiveCensus = {
      preserved: { count: 0, bytes: 0, imageIds: [] },
      acknowledgementPending: { count: 0, bytes: 0, imageIds: [] },
      unverified: { count: 0, bytes: 0, imageIds: [] },
      damaged: { count: 0, imageIds: [] },
    }

    const entries = await readdir(join(base, storeId)).catch(error => {
      if (isFileError(error) && error.code === 'ENOENT') return []
      throw error
    })

    for (const imageId of entries) {
      if (imageId.startsWith('.')) continue

      const target = directory(storeId, imageId)
      const size = await stat(join(target, 'original.imagebytes')).then(file => file.size, () => undefined)

      if (size === undefined) {
        result.damaged.count++
        result.damaged.imageIds.push(imageId)
      } else if (await exists(join(target, 'acknowledgement.json'))) {
        result.preserved.count++
        result.preserved.bytes += size
        result.preserved.imageIds.push(imageId)
      } else if (await exists(join(target, 'receipt.json'))) {
        result.acknowledgementPending.count++
        result.acknowledgementPending.bytes += size
        result.acknowledgementPending.imageIds.push(imageId)
      } else {
        result.unverified.count++
        result.unverified.bytes += size
        result.unverified.imageIds.push(imageId)
      }
    }

    return result
  }

  return {
    recordIntent: intent => operation(async () => {
      const validated = AcquisitionIntentSchema.parse(intent)
      const path = intentPath(validated.storeId, validated.requestId)

      await assertInPlace()
      await ensureDirectory(dirname(path), base)
      await publishOnce(path, JSON.stringify(validated, null, 2))
    }),
    intent: (storeId, requestId) => operation(async () => {
      const bytes = await readOptional(intentPath(storeId, requestId))

      return bytes && AcquisitionIntentSchema.parse(JSON.parse(bytes.toString('utf8')))
    }),
    preserve: ({ expected, original, preservedBy }) => operation(async () => {
      const validated = ExpectedAcquisitionSchema.parse(expected)

      if (original.byteLength !== validated.source.bytes || sha256(original) !== validated.source.sha256)
        throw new ArchiveConflictError('Original bytes do not match their Cria source digest', 'original')

      await assertInPlace()
      const target = await publish(validated, original, preservedBy)
      const receipt = await exclusive(target, () => receiptFor(validated, target))

      // The copy went to the opened directory whatever happened meanwhile; hand its receipt to
      // Cria only if that directory is still the archive at its path.
      await assertInPlace()

      return receipt
    }),
    receipt: expected => operation(async () => {
      const validated = ExpectedAcquisitionSchema.parse(expected)
      const target = directory(validated.source.storeId, validated.source.imageId)

      if (!await readOptional(join(target, 'context.json'))) return undefined

      return exclusive(target, async () => {
        await assertInPlace()
        await ensureDirectory(join(base, validated.source.storeId), base)
        await fs.syncDirectory(join(base, validated.source.storeId))
        const receipt = await receiptFor(validated, target)

        await assertInPlace()

        return receipt
      })
    }),
    acknowledged: (receipt, sourceState) => operation(async () => {
      const target = directory(receipt.storeId, receipt.imageId)

      await exclusive(target, async () => {
        await assertInPlace()
        await publishOnce(join(target, 'acknowledgement.json'), JSON.stringify({
          receiptId: receipt.receiptId,
          sourceState,
          acknowledgedAt: new Date().toISOString(),
        }, null, 2))
      })
    }),
    unacknowledged: storeId => operation(async () => {
      const receipts: ArchiveReceipt[] = []
      const unreceipted: string[] = []
      const problems: string[] = []
      const damaged: Array<{ imageId: string; subject: ArchiveConflictSubject; message: string }> = []

      await assertInPlace()

      if (!await exists(join(base, storeId))) return { receipts, unreceipted, problems, damaged }

      // Receipts listed here may be sent; re-link the store path in case of an earlier interruption.
      await ensureDirectory(join(base, storeId), base)
      await fs.syncDirectory(join(base, storeId))

      for (const imageId of await readdir(join(base, storeId))) {
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

          if (error instanceof ArchiveConflictError) damaged.push({ imageId, subject: error.subject, message: error.message })
        }
      }

      // These receipts are about to be resent to Cria.
      await assertInPlace()

      return { receipts, unreceipted, problems, damaged }
    }),
    original: (storeId, imageId) => operation(async () => {
      const target = directory(storeId, imageId)

      if (!await readOptional(join(target, 'receipt.json'))) return undefined
      const files = await stored(target)

      return (await existingReceipt(target, files)) && new Uint8Array(files.original)
    }),
    issuedReceipt: (storeId, imageId) => operation(async () => {
      const target = directory(storeId, imageId)

      if (!await readOptional(join(target, 'receipt.json'))) return undefined

      return existingReceipt(target, await stored(target))
    }),
    status: () => operation(archiveStatus),
    census: storeId => operation(() => census(storeId)),
    async close() {
      if (closed) return
      closed = true
      await Promise.allSettled(inflight)
      await releaseOwnership()
      closeSync(descriptor)
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
      throw new ArchiveConflictError('Archived context differs from the expected acquisition context', 'context')

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
        throw new ArchiveConflictError('Original bytes do not match their Cria source digest', 'original')

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

      return { receipts, unreceipted, problems: [], damaged: [] }
    },
    async original(storeId, imageId) {
      const entry = entries.get(`${storeId}/${imageId}`)

      return entry?.receipt && new Uint8Array(entry.original)
    },
    async issuedReceipt(storeId, imageId) {
      return entries.get(`${storeId}/${imageId}`)?.receipt
    },
    async status() {
      return { root: 'memory', location: 'opened', writable: true, space: null }
    },
    async census(storeId) {
      const census: ArchiveCensus = {
        preserved: { count: 0, bytes: 0, imageIds: [] },
        acknowledgementPending: { count: 0, bytes: 0, imageIds: [] },
        unverified: { count: 0, bytes: 0, imageIds: [] },
        damaged: { count: 0, imageIds: [] },
      }

      for (const entry of entries.values()) {
        const { imageId, storeId: entryStore } = entry.manifest.source

        if (entryStore !== storeId) continue
        const bytes = entry.original.byteLength

        if (entry.acknowledged) {
          census.preserved.count++
          census.preserved.bytes += bytes
          census.preserved.imageIds.push(imageId)
          continue
        }

        const pending = entry.receipt ? census.acknowledgementPending : census.unverified

        pending.count++
        pending.bytes += bytes
        pending.imageIds.push(imageId)
      }

      return census
    },
    async close() {},
  }
}
