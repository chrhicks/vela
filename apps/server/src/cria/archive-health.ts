import { EquipmentError } from '@vela/equipment'
import { CriaApiError, type CriaClient, type CriaCustody, type CriaStorage } from '@vela/cria'
import type {
  ArchiveDestinationView,
  ArchiveForecastView,
  ArchiveHealthStatus,
  ArchiveIssue,
  ArchiveIssueReason,
  ArchiveObligationsView,
  ArchiveSourceView,
  ArchiveTally,
  CriaArchiveHealthView,
} from '@vela/model/web'
import { ArchiveConflictError, type AcquisitionArchive, type AcquisitionIntent, type ArchiveStatus } from '../acquisitions/archive.js'

/** Engineering bounds on one health read; they limit work, not what Vela keeps. */
export const ARCHIVE_HEALTH_LIMITS = {
  /** A health read is reused for this long, however many browsers poll. */
  maxAgeMs: 5_000,
  /** Archive entries listed per read before the census is reported as partial. */
  censusEntries: 20_000,
  /** Pending Vela copies checked individually against Cria to avoid counting them twice. */
  overlapChecks: 50,
  /** Pages of Cria `missing` records counted per read, 100 each. */
  missingPages: 5,
  /** Issues returned per view, most recent first. */
  shownIssues: 20,
  /** Recent acquisitions used for the observed rate. */
  rateSamples: 10,
} as const

type Provenance = Pick<ArchiveIssue, 'requestId' | 'operationId' | 'purpose'>

/** What failed, by the boundary that reported it. */
export type ArchiveFailure =
  | { scope: 'destination'; detail: string }
  | { scope: 'image'; reason: ArchiveIssueReason; detail: string }

const message = (error: Error | null, fallback: string) => error?.message ?? fallback

/**
 * Translate a failure while preserving or acknowledging one original. A failed archive write is
 * destination-wide; anything Cria reports concerns this original; a conflict names what differs.
 */
export function classifyArchiveFailure(error: Error | null, stage: 'preserve' | 'acknowledge'): ArchiveFailure {
  if (error instanceof ArchiveConflictError)
    return { scope: 'image', reason: `${error.subject}-mismatch`, detail: error.message }

  if (error instanceof CriaApiError && error.code === 'receipt-conflict')
    return { scope: 'image', reason: 'receipt-conflict', detail: 'Cria accepted a different archive receipt for this original' }

  if (error instanceof EquipmentError)
    return stage === 'acknowledge'
      ? { scope: 'image', reason: 'acknowledgement-pending', detail: `Cria has not confirmed the receipt: ${error.message}` }
      : { scope: 'image', reason: 'source-unavailable', detail: error.message }

  return { scope: 'destination', detail: message(error, 'archive write failed') }
}

/**
 * Ephemeral facts only this server observes: attempts, refusals and recent acquisitions. Durable
 * counts never come from here, so repeated or concurrent recovery cannot inflate them. An issue
 * belongs to one original and is cleared only by that original's own success.
 */
export function createArchiveHealthTracker(now: () => Date = () => new Date()) {
  const issues = new Map<string, ArchiveIssue>()
  const acquisitions: Array<{ at: number; bytes: number }> = []
  let writeFailure: { at: string; detail: string } | null = null
  let intentRefusal: { at: string; detail: string } | null = null
  let lastPreservedAt: string | null = null

  return {
    /** Intent could not be recorded, so the capture was refused before any request was sent. */
    intentRefused(detail: string) {
      intentRefusal = { at: now().toISOString(), detail }
    },
    /** Intent was recorded again, so the archive accepts new captures; an earlier refusal is resolved. */
    intentRecorded() {
      intentRefusal = null
    },
    /** A newly acquired original arrived at Vela, before preservation is attempted. */
    acquired(bytes: number) {
      acquisitions.push({ at: now().getTime(), bytes })
      acquisitions.splice(0, Math.max(0, acquisitions.length - ARCHIVE_HEALTH_LIMITS.rateSamples))
    },
    /** This original is verified at Vela and acknowledged by Cria. */
    preserved(imageId: string) {
      issues.delete(imageId)
      lastPreservedAt = now().toISOString()
      writeFailure = null
    },
    failed(imageId: string, failure: ArchiveFailure, provenance: Provenance) {
      const at = now().toISOString()

      if (failure.scope === 'destination') {
        writeFailure = { at, detail: failure.detail }

        return
      }

      issues.set(imageId, { imageId, reason: failure.reason, detail: failure.detail, observedAt: at, ...provenance })
    },
    /** Cria no longer holds this original and nothing remains to do for it here. */
    settled(imageId: string) {
      issues.delete(imageId)
    },
    snapshot() {
      return {
        issues: [...issues.values()],
        acquisitions: [...acquisitions],
        writeFailure,
        intentRefusal,
        lastPreservedAt,
      }
    },
  }
}

export type ArchiveHealthTracker = ReturnType<typeof createArchiveHealthTracker>

export function provenanceOf(record: CriaCustody | undefined, intent?: AcquisitionIntent | null): Provenance {
  return {
    requestId: record?.requestId ?? intent?.requestId ?? null,
    operationId: record?.operationId ?? null,
    purpose: intent?.purpose ?? null,
  }
}

interface SourceReading {
  storage: CriaStorage
  missing: { count: number; complete: boolean; records: CriaCustody[] }
  quarantined: CriaCustody[]
  /** Pending Vela copies that Cria still lists as retained, to subtract from its waiting total. */
  overlap: { tally: ArchiveTally; complete: boolean }
}

/**
 * One store's preservation health: durable facts from Cria and Vela's archive, joined by image
 * identity, plus the tracker's recent attempts. Reads are cached and coalesced, so polling
 * browsers share one bounded set of reads. Nothing here sends a command to equipment.
 */
export function createArchiveHealth({
  client,
  archive,
  tracker,
  storeId,
  reconcile,
  now = () => new Date(),
}: {
  client: CriaClient
  archive: AcquisitionArchive
  tracker: ArchiveHealthTracker
  storeId: string
  /** Run the same recovery pass the server already runs on its interval. */
  reconcile: () => Promise<void>
  now?: () => Date
}) {
  let lastSource: { reading: SourceReading; at: string } | null = null
  let sourceError: string | null = null
  let cached: { view: StoreHealth; at: number } | null = null
  let refreshing: Promise<StoreHealth> | undefined
  let reconciling: Promise<void> | undefined

  async function readSource(census: ArchiveStatus['census']): Promise<SourceReading> {
    const storage = await client.storage()
    const missingRecords: CriaCustody[] = []
    let missingComplete = false

    for (let after = 0, page = 0; page < ARCHIVE_HEALTH_LIMITS.missingPages; page++) {
      const result = await client.custodyPage(['missing'], after, 100)

      missingRecords.push(...result.images)

      if (result.next <= after) {
        missingComplete = true
        break
      }

      after = result.next
    }

    const quarantined = storage.images.states.quarantined.records > 0
      ? (await client.custodyPage(['quarantined'], 0, ARCHIVE_HEALTH_LIMITS.shownIssues)).images
      : []

    const pending = census ? [...census.unverified.imageIds, ...census.acknowledgementPending.imageIds] : []
    const overlap = { tally: { count: 0, bytes: 0 }, complete: census !== null && pending.length <= ARCHIVE_HEALTH_LIMITS.overlapChecks }

    for (const imageId of pending.slice(0, ARCHIVE_HEALTH_LIMITS.overlapChecks)) {
      const record = await client.custody(imageId).catch(error => {
        if (error instanceof CriaApiError && error.status === 404) return undefined
        throw error
      })

      if (record?.state === 'retained' && record.image) {
        overlap.tally.count++
        overlap.tally.bytes += record.image.original.bytes
      }
    }

    return {
      storage,
      missing: { count: missingRecords.length, complete: missingComplete, records: missingRecords },
      quarantined,
      overlap,
    }
  }

  async function refresh(): Promise<StoreHealth> {
    const observedAt = now()
    let status: ArchiveStatus | null = null
    let archiveError: string | null = null

    try {
      status = await archive.status(storeId, { limit: ARCHIVE_HEALTH_LIMITS.censusEntries })
    } catch (error) {
      archiveError = message(error instanceof Error ? error : null, 'archive could not be listed')
    }

    try {
      lastSource = { reading: await readSource(status?.census ?? null), at: observedAt.toISOString() }
      sourceError = null
    } catch (error) {
      sourceError = message(error instanceof Error ? error : null, 'Cria custody could not be read')
    }

    return project(storeId, {
      observedAt: observedAt.toISOString(),
      nowMs: observedAt.getTime(),
      status,
      archiveError,
      source: lastSource,
      sourceError,
      tracked: tracker.snapshot(),
      reconciling: reconciling !== undefined,
    })
  }

  async function current(force = false): Promise<StoreHealth> {
    if (!force && cached && now().getTime() - cached.at < ARCHIVE_HEALTH_LIMITS.maxAgeMs)
      return { ...cached.view, reconciling: reconciling !== undefined }

    refreshing ??= refresh()
      .then(view => {
        cached = { view, at: now().getTime() }

        return view
      })
      .finally(() => { refreshing = undefined })

    return refreshing
  }

  return {
    storeId,
    view: () => current(),
    /**
     * Rescan now: resend verified receipts and transfer the same retained originals again. This
     * never takes an exposure, replaces a receipt or context, or touches an uncertain operation.
     */
    async reconcile() {
      reconciling ??= reconcile().catch(() => {}).finally(() => { reconciling = undefined })
      await reconciling

      return current(true)
    },
  }
}

export type ArchiveHealth = ReturnType<typeof createArchiveHealth>

/** The store's part of the view; the route adds the rig's identity. */
export type StoreHealth = Omit<CriaArchiveHealthView, 'rigId' | 'rigName' | 'preservation'>

interface ProjectionInput {
  observedAt: string
  nowMs: number
  status: ArchiveStatus | null
  archiveError: string | null
  source: { reading: SourceReading; at: string } | null
  sourceError: string | null
  tracked: ReturnType<ArchiveHealthTracker['snapshot']>
  reconciling: boolean
}

const tally = (count: number, bytes: number): ArchiveTally => ({ count, bytes })

function destinationOf(input: ProjectionInput): ArchiveDestinationView {
  const { status, archiveError, tracked, observedAt } = input
  let problem: ArchiveDestinationView['problem'] = null

  if (!status) problem = { kind: 'unreadable', detail: archiveError ?? 'The archive could not be read', observedAt }
  else if (status.location === 'missing')
    problem = { kind: 'missing', detail: 'The archive folder no longer exists. Its disk may be unmounted.', observedAt }
  else if (status.location === 'replaced')
    problem = { kind: 'replaced', detail: 'The archive path now leads to a different folder than the one Vela opened. Its disk may be unmounted.', observedAt }
  else if (!status.writable)
    problem = { kind: 'not-writable', detail: 'Vela may not write to the archive folder.', observedAt }
  else if (tracked.writeFailure)
    problem = { kind: 'write-failed', detail: tracked.writeFailure.detail, observedAt: tracked.writeFailure.at }

  return {
    location: status?.root ?? 'unknown',
    state: problem ? 'unavailable' : 'available',
    problem,
    intentRefusal: tracked.intentRefusal,
    lastPreservedAt: tracked.lastPreservedAt,
    space: status?.space ?? null,
  }
}

function sourceOf(input: ProjectionInput, storeId: string): ArchiveSourceView {
  const reading = input.source?.reading
  const images = reading?.storage.images

  return {
    storeId,
    observedAt: input.source?.at ?? null,
    current: input.sourceError === null && reading !== undefined,
    error: input.sourceError,
    capacity: images
      ? {
          committedBytes: images.committedBytes,
          budgetBytes: images.budgetBytes,
          reservationBytes: images.reservationBytes,
          freeBytes: images.freeBytes,
          freeSpaceReserveBytes: images.freeSpaceReserveBytes,
          outstandingRecords: images.outstandingRecords,
          recordLimit: images.recordLimit,
          captureAdmissible: images.captureAdmissible,
          refusal: images.refusal,
        }
      : null,
    releaseAfterReceipt: images?.releaseArchivedOriginals ?? null,
    extraCopies: images ? tally(images.states.archived.records, images.states.archived.bytes) : null,
    quarantined: images ? tally(images.states.quarantined.records, images.states.quarantined.bytes) : null,
    missing: reading ? { count: reading.missing.count, complete: reading.missing.complete } : null,
  }
}

function obligationsOf(input: ProjectionInput, source: ArchiveSourceView): ArchiveObligationsView {
  const census = input.status?.census ?? null
  const reading = input.source?.reading
  const retained = reading?.storage.images.states.retained

  // An original Vela already copied is counted at Vela, not again as waiting at Cria.
  const waitingAtCria = retained && reading
    ? tally(Math.max(0, retained.records - reading.overlap.tally.count), Math.max(0, retained.bytes - reading.overlap.tally.bytes))
    : null

  return {
    waitingAtCria,
    unverified: census ? tally(census.unverified.count, census.unverified.bytes) : null,
    acknowledgementPending: census ? tally(census.acknowledgementPending.count, census.acknowledgementPending.bytes) : null,
    preserved: census ? tally(census.preserved.count, census.preserved.bytes) : null,
    complete: Boolean(census?.complete && source.current && reading?.overlap.complete),
  }
}

function issuesOf(input: ProjectionInput) {
  const census = input.status?.census
  const pendingAcknowledgement = new Set(census?.acknowledgementPending.imageIds ?? [])
  const reading = input.source?.reading
  const byImage = new Map<string, ArchiveIssue>()

  for (const issue of input.tracked.issues) {
    // An acknowledgement that has since been recorded by another pass is no longer pending.
    if (census && issue.reason === 'acknowledgement-pending' && !pendingAcknowledgement.has(issue.imageId)) continue
    byImage.set(issue.imageId, issue)
  }

  const fromCria = (record: CriaCustody, reason: ArchiveIssueReason, fallback: string): ArchiveIssue => ({
    imageId: record.id,
    reason,
    detail: record.reason ?? fallback,
    observedAt: input.source?.at ?? input.observedAt,
    ...provenanceOf(record),
  })

  for (const record of reading?.missing.records ?? [])
    byImage.set(record.id, fromCria(record, 'missing-at-cria', 'Cria reports this original as missing'))

  for (const record of reading?.quarantined ?? [])
    byImage.set(record.id, fromCria(record, 'quarantined-at-cria', 'Cria kept an unverifiable candidate for inspection'))

  const all = [...byImage.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt))
  const quarantinedBeyondPage = Math.max(0, (reading?.storage.images.states.quarantined.records ?? 0) - (reading?.quarantined.length ?? 0))
  const missingBeyondPages = reading && !reading.missing.complete ? 1 : 0

  return {
    total: all.length + quarantinedBeyondPage,
    shown: all.slice(0, ARCHIVE_HEALTH_LIMITS.shownIssues),
    needsAttention: all.filter(issue => attentionReasons.has(issue.reason)).length + quarantinedBeyondPage + missingBeyondPages,
  }
}

function forecastOf(input: ProjectionInput, obligations: ArchiveObligationsView, destination: ArchiveDestinationView): ArchiveForecastView {
  const samples = input.tracked.acquisitions
  const latest = samples.at(-1)
  const frameBytes = latest ? { bytes: latest.bytes, observedAt: new Date(latest.at).toISOString() } : null
  let rate: ArchiveForecastView['rate'] = null
  let rateUnknown: ArchiveForecastView['rateUnknown'] = 'too-few-acquisitions'

  if (samples.length >= 2 && latest) {
    const first = samples[0]!
    const meanIntervalMs = (latest.at - first.at) / (samples.length - 1)

    // Still acquiring if the next frame is not overdue; an engineering heuristic, not a policy.
    if (meanIntervalMs > 0 && input.nowMs - latest.at <= 3 * meanIntervalMs) {
      rate = { framesPerHour: 3_600_000 / meanIntervalMs, frames: samples.length, since: new Date(first.at).toISOString() }
      rateUnknown = null
    } else rateUnknown = 'not-acquiring'
  }

  const backlogBytes = obligations.waitingAtCria?.bytes ?? null
  const space = destination.space
  let destinationHours: number | null = null

  if (rate && frameBytes && backlogBytes !== null && space?.basis === 'opened-archive' && destination.state === 'available')
    destinationHours = Math.max(0, space.freeBytes - backlogBytes) / (rate.framesPerHour * frameBytes.bytes)

  const capacity = input.source?.reading.storage.images
  let criaCapturesBeforeRefusal: number | null = null

  if (capacity && frameBytes) {
    const frame = frameBytes.bytes
    const reservation = capacity.reservationBytes
    const fits = (room: number) => room >= 0 ? Math.floor(room / frame) + 1 : 0

    // Cria's own admission rules, assuming frames like the latest one and nothing more archived.
    criaCapturesBeforeRefusal = capacity.captureAdmissible
      ? Math.min(
          fits(capacity.budgetBytes - capacity.committedBytes - reservation),
          Math.max(0, capacity.recordLimit - capacity.outstandingRecords),
          fits(capacity.freeBytes - reservation - capacity.freeSpaceReserveBytes),
        )
      : 0
  }

  return { frameBytes, rate, rateUnknown, backlogBytes, destinationHours, criaCapturesBeforeRefusal, totalRequirement: 'unknown' }
}

const attentionReasons = new Set<ArchiveIssueReason>([
  'original-mismatch', 'context-mismatch', 'receipt-mismatch', 'receipt-conflict', 'unvouched-copy', 'missing-at-cria', 'quarantined-at-cria',
])

function statusOf(
  destination: ArchiveDestinationView,
  source: ArchiveSourceView,
  obligations: ArchiveObligationsView,
  issues: ReturnType<typeof issuesOf>,
): ArchiveHealthStatus {
  if (destination.state === 'unavailable') return 'degraded'

  if (issues.needsAttention > 0) return 'attention'

  if (!source.current || !obligations.complete) return 'unknown'

  const outstanding = [obligations.waitingAtCria, obligations.unverified, obligations.acknowledgementPending]

  return outstanding.some(item => (item?.count ?? 0) > 0) || issues.total > 0 ? 'catching-up' : 'current'
}

function project(storeId: string, input: ProjectionInput): StoreHealth {
  const destination = destinationOf(input)
  const source = sourceOf(input, storeId)
  const obligations = obligationsOf(input, source)
  const issues = issuesOf(input)

  return {
    observedAt: input.observedAt,
    status: statusOf(destination, source, obligations, issues),
    obligations,
    destination,
    source,
    issues: { total: issues.total, shown: issues.shown },
    forecast: forecastOf(input, obligations, destination),
    reconciling: input.reconciling,
  }
}
