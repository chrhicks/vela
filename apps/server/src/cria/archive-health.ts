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
import {
  ArchiveConflictError,
  type AcquisitionArchive,
  type AcquisitionIntent,
  type ArchiveCensus,
  type ArchiveStatus,
} from '../acquisitions/archive.js'

/** Engineering bounds on one health read; they limit work, not what Vela keeps. */
export const ARCHIVE_HEALTH_LIMITS = {
  /** A health read is reused for this long, however many browsers poll. */
  maxAgeMs: 5_000,
  /**
   * A health read waits at most this long for an archive census. A slower census finishes in the
   * background and the read uses the last completed one, labelled with when it was counted.
   */
  censusWaitMs: 1_000,
  /** Check archive now waits longer, so its result usually reflects the work it just did. */
  reconcileCensusWaitMs: 10_000,
  /** A census is reused for this multiple of its own measured duration, and at least maxAgeMs. */
  censusReuseFactor: 10,
  /** Older than this, or than three reuse periods, a census no longer counts as current. */
  censusCurrentMs: 60_000,
  /** Pending Vela copies checked individually against Cria to avoid counting them twice. */
  overlapChecks: 50,
  /** Retained originals inspected for ones the active capture owns; larger backlogs count as waiting. */
  arrivingScan: 20,
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

const message = (error: Error | null, fallback: string) => error?.message.trim() || fallback

const fileProblems = new Map([
  ['EACCES', 'Permission denied'],
  ['EPERM', 'Permission denied'],
  ['ENOSPC', 'No space left on the archive disk'],
  ['EDQUOT', 'Disk quota exceeded'],
  ['EROFS', 'The archive disk is read-only'],
  ['ENOENT', 'An archive folder is missing'],
  ['EIO', 'The archive disk reported an input/output error'],
])

function isFileError(error: Error | null): error is NodeJS.ErrnoException {
  return error !== null && 'code' in error
}

/**
 * A safe explanation of an archive write failure. Operating-system messages name temporary
 * files and full paths; the error code says what Chris can act on.
 */
export function describeArchiveError(error: Error | null, fallback: string) {
  const known = isFileError(error) && error.code ? fileProblems.get(error.code) : undefined

  return known ?? message(error, fallback)
}

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
      : { scope: 'image', reason: 'source-unavailable', detail: message(error, 'Cria could not provide this original') }

  return { scope: 'destination', detail: describeArchiveError(error, 'archive write failed') }
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
  /** Retained originals an active capture owns and is preserving now; null when not inspected. */
  arriving: ArchiveTally | null
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
  owns,
  now = () => new Date(),
}: {
  client: CriaClient
  archive: AcquisitionArchive
  tracker: ArchiveHealthTracker
  storeId: string
  /** Run the same recovery pass the server already runs on its interval. */
  reconcile: () => Promise<void>
  /** Whether an active acquisition owns this request and preserves its original itself. */
  owns: (requestId: string) => boolean
  now?: () => Date
}) {
  let lastSource: { reading: SourceReading; at: string } | null = null
  let sourceError: string | null = null
  let cached: { view: StoreHealth; at: number } | null = null
  let refreshing: Promise<StoreHealth> | undefined
  let reconciling: Promise<void> | undefined
  let census: { value: ArchiveCensus; atMs: number; durationMs: number } | null = null
  let censusError: string | null = null
  let counting: Promise<void> | undefined

  const reuseMs = () => census ? Math.max(ARCHIVE_HEALTH_LIMITS.maxAgeMs, ARCHIVE_HEALTH_LIMITS.censusReuseFactor * census.durationMs) : 0

  /** One census at a time, shared by every reader; it never runs on the read path's clock. */
  function count() {
    counting ??= (async () => {
      const startedAt = now().getTime()
      const started = performance.now()
      const value = await archive.census(storeId)

      census = { value, atMs: startedAt, durationMs: performance.now() - started }
      censusError = null
    })()
      .catch(error => { censusError = message(error instanceof Error ? error : null, 'archive could not be listed') })
      .finally(() => { counting = undefined })

    return counting
  }

  /** Wait for `work`, but never longer than `ms`; the work continues either way. */
  async function within(work: Promise<void> | undefined, ms: number) {
    let timer: NodeJS.Timeout | undefined

    await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, ms) })])
    clearTimeout(timer)
  }

  const currentMs = () => Math.max(ARCHIVE_HEALTH_LIMITS.censusCurrentMs, 3 * reuseMs())

  /**
   * Reuse a recent census. Past its reuse period, recount in the background and answer with the
   * existing one; wait (briefly) only when there is none yet or it is no longer current.
   */
  async function recentCensus() {
    const age = census ? now().getTime() - census.atMs : Infinity

    if (age < reuseMs()) return

    if (age <= currentMs()) void count()
    else await within(count(), ARCHIVE_HEALTH_LIMITS.censusWaitMs)
  }

  /** A census that started after the caller's work, waited for within one deadline. */
  async function freshCensus(ms: number) {
    const deadline = performance.now() + ms

    if (counting) await within(counting, ms)

    if (!counting) await within(count(), Math.max(0, deadline - performance.now()))
  }

  async function readSource(census: ArchiveCensus | null): Promise<SourceReading> {
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

    // Only a small backlog is inspected; beyond that every retained original counts as waiting.
    const retained = storage.images.states.retained.records
    let arriving: ArchiveTally | null = null

    if (retained > 0 && retained <= ARCHIVE_HEALTH_LIMITS.arrivingScan) {
      const atVela = new Set(pending)

      arriving = { count: 0, bytes: 0 }

      for (const record of (await client.custodyPage(['retained'], 0, ARCHIVE_HEALTH_LIMITS.arrivingScan)).images) {
        if (!owns(record.requestId) || atVela.has(record.id) || !record.image) continue
        arriving.count++
        arriving.bytes += record.image.original.bytes
      }
    }

    return {
      storage,
      missing: { count: missingRecords.length, complete: missingComplete, records: missingRecords },
      quarantined,
      overlap,
      arriving,
    }
  }

  async function refresh(): Promise<StoreHealth> {
    let status: ArchiveStatus | null = null
    let archiveError: string | null = null

    try {
      status = await archive.status()
    } catch (error) {
      archiveError = message(error instanceof Error ? error : null, 'archive could not be read')
    }

    if (status?.location === 'opened') await recentCensus()

    const observedAt = now()

    // Only a census of the folder Vela opened describes the archive.
    const counted = status?.location === 'opened' && census
      ? {
          value: census.value,
          at: new Date(census.atMs).toISOString(),
          current: observedAt.getTime() - census.atMs <= currentMs(),
        }
      : null

    try {
      lastSource = { reading: await readSource(counted?.value ?? null), at: observedAt.toISOString() }
      sourceError = null
    } catch (error) {
      sourceError = message(error instanceof Error ? error : null, 'Cria custody could not be read')
    }

    return project(storeId, {
      observedAt: observedAt.toISOString(),
      nowMs: observedAt.getTime(),
      status,
      archiveError,
      census: counted,
      censusError: status?.location === 'opened' ? censusError : null,
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

      // Count again after the work, and never return a read that started before it finished.
      await freshCensus(ARCHIVE_HEALTH_LIMITS.reconcileCensusWaitMs)
      await refreshing?.catch(() => {})

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
  /** The latest completed census of the opened folder, or null before the first one finishes. */
  census: { value: ArchiveCensus; at: string; current: boolean } | null
  censusError: string | null
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
  else if (input.censusError)
    problem = { kind: 'unreadable', detail: `The archive could not be listed: ${input.censusError}`, observedAt }
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
  const census = input.census?.value ?? null
  const reading = input.source?.reading
  const retained = reading?.storage.images.states.retained

  const partial: ArchiveObligationsView['partial'] = []

  if (!source.current) partial.push(source.observedAt ? 'cria-last-known' : 'cria-unread')

  if (!input.census) partial.push('archive-not-counted')
  else if (!input.census.current) partial.push('archive-count-old')

  if (input.census && reading && !reading.overlap.complete) partial.push('pending-copies-unchecked')

  if (reading && !reading.missing.complete) partial.push('missing-unchecked')

  // An original Vela already copied, or one the active capture is preserving, is not waiting.
  const arriving = reading ? (reading.arriving ?? tally(0, 0)) : null

  const waitingAtCria = retained && reading && arriving
    ? tally(
        Math.max(0, retained.records - reading.overlap.tally.count - arriving.count),
        Math.max(0, retained.bytes - reading.overlap.tally.bytes - arriving.bytes),
      )
    : null

  return {
    arriving,
    waitingAtCria,
    unverified: census ? tally(census.unverified.count, census.unverified.bytes) : null,
    acknowledgementPending: census ? tally(census.acknowledgementPending.count, census.acknowledgementPending.bytes) : null,
    preserved: census ? tally(census.preserved.count, census.preserved.bytes) : null,
    archiveCountedAt: input.census?.at ?? null,
    complete: partial.length === 0,
    partial,
  }
}

function issuesOf(input: ProjectionInput) {
  const census = input.census?.value
  const preserved = new Set(census?.preserved.imageIds ?? [])
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
    detail: record.reason?.trim() || fallback,
    observedAt: input.source?.at ?? input.observedAt,
    ...provenanceOf(record),
  })

  // Cria's extra copy may vanish after Vela preserved and Cria acknowledged it; nothing is lost then.
  // Until the archive has been counted that cannot be told apart, so missing records wait for it.
  for (const record of census ? reading?.missing.records ?? [] : []) {
    if (!preserved.has(record.id))
      byImage.set(record.id, fromCria(record, 'missing-at-cria', 'Cria reports this original as missing'))
  }

  for (const imageId of census?.damaged.imageIds ?? []) {
    byImage.set(imageId, {
      imageId,
      reason: 'original-mismatch',
      detail: 'The archived original file is missing',
      observedAt: input.census?.at ?? input.observedAt,
      requestId: null,
      operationId: null,
      purpose: null,
    })
  }

  for (const record of reading?.quarantined ?? [])
    byImage.set(record.id, fromCria(record, 'quarantined-at-cria', 'Cria kept an unverifiable candidate for inspection'))

  const all = [...byImage.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt))
  const quarantinedBeyondPage = Math.max(0, (reading?.storage.images.states.quarantined.records ?? 0) - (reading?.quarantined.length ?? 0))

  return {
    total: all.length + quarantinedBeyondPage,
    shown: all.slice(0, ARCHIVE_HEALTH_LIMITS.shownIssues),
    // Records beyond the pages read are a partial total, not invented issues.
    needsAttention: all.filter(issue => attentionReasons.has(issue.reason)).length + quarantinedBeyondPage,
  }
}

function forecastOf(input: ProjectionInput, obligations: ArchiveObligationsView, destination: ArchiveDestinationView): ArchiveForecastView {
  const samples = input.tracked.acquisitions
  const latest = samples.at(-1)
  const frameBytes = latest ? { bytes: latest.bytes, observedAt: new Date(latest.at).toISOString() } : null
  let rate: ArchiveForecastView['rate'] = null
  let rateUnknown: ArchiveForecastView['rateUnknown'] = 'too-few-acquisitions'

  const run = recentRun(samples.map(sample => sample.at))

  if (run && latest) {
    // Still acquiring if the next frame is not overdue; an engineering heuristic, not a policy.
    if (run.meanIntervalMs > 0 && input.nowMs - latest.at <= 3 * run.meanIntervalMs) {
      rate = { framesPerHour: 3_600_000 / run.meanIntervalMs, frames: run.frames, since: new Date(run.since).toISOString() }
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

/**
 * The latest run of acquisitions at one cadence: walking back from the newest, stop at an interval
 * more than three times longer or shorter than the run's typical one. A pause, or a burst such as
 * autofocus before a capture run, is then not averaged into the rate.
 */
function recentRun(times: number[]) {
  if (times.length < 2) return null

  const intervals: number[] = []

  for (let index = times.length - 1; index > 0; index--) {
    const interval = times[index]! - times[index - 1]!
    const sorted = [...intervals].sort((a, b) => a - b)
    const typical = sorted[Math.floor(sorted.length / 2)]

    if (typical !== undefined && (interval > 3 * typical || 3 * interval < typical)) break
    intervals.push(interval)
  }

  const total = intervals.reduce((sum, interval) => sum + interval, 0)

  return { meanIntervalMs: total / intervals.length, frames: intervals.length + 1, since: times.at(-1)! - total }
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
    issues: { total: issues.total, needsAttention: issues.needsAttention, shown: issues.shown },
    forecast: forecastOf(input, obligations, destination),
    reconciling: input.reconciling,
  }
}
