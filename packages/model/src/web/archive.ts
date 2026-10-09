/** How many originals, and their measured size in bytes. */
export interface ArchiveTally {
  count: number
  bytes: number
}

/**
 * Server-resolved preservation summary, most pressing first:
 * `degraded` when the Vela archive cannot accept originals (Cria keeps them meanwhile),
 * `attention` when particular originals need inspection, `unknown` when current information is
 * missing, `catching-up` while originals move through transfer, verification or acknowledgement,
 * and `current` when every known original is preserved and acknowledged.
 */
export type ArchiveHealthStatus = 'degraded' | 'attention' | 'unknown' | 'catching-up' | 'current'

/** Stable reasons a particular original is not yet safely preserved. */
export type ArchiveIssueReason =
  /** Cria could not provide this original or its record just now; retried later. */
  | 'source-unavailable'
  /** Bytes differ from Cria's recorded digest. */
  | 'original-mismatch'
  /** The stored or Cria-provided acquisition context is incomplete or differs. */
  | 'context-mismatch'
  /** A stored receipt does not match the files it describes. */
  | 'receipt-mismatch'
  /** Vela verified the original, but Cria has not confirmed the receipt; the copy is safe. */
  | 'acknowledgement-pending'
  /** Cria accepted another archive's receipt for this original. */
  | 'receipt-conflict'
  /** A copy without a receipt whose original Cria no longer holds. */
  | 'unvouched-copy'
  /** Cria reports its original as missing. */
  | 'missing-at-cria'
  /** Cria kept an unverifiable candidate file for inspection. */
  | 'quarantined-at-cria'

export interface ArchiveIssue {
  imageId: string
  reason: ArchiveIssueReason
  /** Explanation from the boundary that found it. */
  detail: string
  observedAt: string
  requestId: string | null
  operationId: string | null
  purpose: 'capture' | 'autofocus' | 'framing' | 'alignment' | null
}

export type ArchiveDestinationProblemKind =
  /** The archive folder no longer exists, for example because its disk was unmounted. */
  | 'missing'
  /** The configured path now leads to a different folder than the one Vela opened. */
  | 'replaced'
  /** This process may not write to the archive folder. */
  | 'not-writable'
  /** The archive could not be listed. */
  | 'unreadable'
  /** The most recent original write failed and none has succeeded since. */
  | 'write-failed'

/** Vela's own archive on this server. */
export interface ArchiveDestinationView {
  /** Archive folder on the Vela server. */
  location: string
  state: 'available' | 'unavailable'
  problem: { kind: ArchiveDestinationProblemKind; detail: string; observedAt: string } | null
  /** The most recent capture refused because intent could not be recorded; no exposure was requested. */
  intentRefusal: { at: string; detail: string } | null
  lastPreservedAt: string | null
  /**
   * Free space of the filesystem that holds the opened archive. `other-location` means the archive
   * folder could not be measured, so this describes `measuredPath` instead and is only an estimate.
   */
  space: {
    freeBytes: number
    totalBytes: number
    measuredPath: string
    basis: 'opened-archive' | 'other-location'
  } | null
}

/** Cria's local custody: its own disk and capacity, distinct from Vela's archive. */
export interface ArchiveSourceView {
  storeId: string
  /** Last successful read of Cria's custody totals. */
  observedAt: string | null
  /** False when the latest read failed; the values below are then the last known ones. */
  current: boolean
  error: string | null
  capacity: {
    committedBytes: number
    budgetBytes: number
    reservationBytes: number
    freeBytes: number
    freeSpaceReserveBytes: number
    outstandingRecords: number
    recordLimit: number
    captureAdmissible: boolean
    refusal: string | null
  } | null
  /** Whether Cria deletes its copy once it accepts a receipt. */
  releaseAfterReceipt: boolean | null
  /** Acknowledged originals Cria still keeps because release after receipt is off. */
  extraCopies: ArchiveTally | null
  quarantined: ArchiveTally | null
  missing: { count: number; complete: boolean } | null
}

/**
 * Where each known original stands; each is counted once. A null tally is unknown: Cria has not
 * been read, or Vela's archive folder cannot be listed.
 */
export interface ArchiveObligationsView {
  /** Originals the active capture is preserving right now; a failure there is reported at once. */
  arriving: ArchiveTally | null
  /** Originals only Cria holds, waiting for transfer to Vela. */
  waitingAtCria: ArchiveTally | null
  /** Copied to Vela but not yet verified. */
  unverified: ArchiveTally | null
  /** Verified at Vela; Cria has not confirmed the receipt. */
  acknowledgementPending: ArchiveTally | null
  /** Verified at Vela and acknowledged by Cria. */
  preserved: ArchiveTally | null
  /**
   * When Vela's archive was last counted. Counting runs in the background, so the Vela tallies can
   * be older than the view; null until the first count finishes.
   */
  archiveCountedAt: string | null
  /** True when no reason below applies. */
  complete: boolean
  /** Why the totals are not complete, most fundamental first. */
  partial: Array<
    /** Cria has not been read since Vela started. */
    | 'cria-unread'
    /** Cria's latest read failed; its totals are last known. */
    | 'cria-last-known'
    /** Vela's archive has not finished its first count. */
    | 'archive-not-counted'
    /** The latest archive count is no longer recent; a new one is running. */
    | 'archive-count-old'
    /** More copies await Cria's confirmation than one read checks, so some may be counted twice. */
    | 'pending-copies-unchecked'
    /** Cria reports more missing originals than one read lists; the rest are not checked. */
    | 'missing-unchecked'
  >
}

/** Estimates from measured evidence only; null wherever the evidence is insufficient. */
export interface ArchiveForecastView {
  /** Measured length of the most recent acquired original. */
  frameBytes: { bytes: number; observedAt: string } | null
  /** Recent acquisition rate this server observed. */
  rate: { framesPerHour: number; frames: number; since: string } | null
  rateUnknown: 'too-few-acquisitions' | 'not-acquiring' | null
  /** Bytes the Vela archive still needs for originals waiting at Cria. */
  backlogBytes: number | null
  /** Hours until the archive filesystem is full at the observed rate, after the backlog. */
  destinationHours: number | null
  /** Captures Cria could still admit by its own capacity rules if nothing more were archived. */
  criaCapturesBeforeRefusal: number | null
  /** Capture runs continue until stopped, so the total a session needs is not known. */
  totalRequirement: 'unknown'
}

export interface CriaArchiveHealthView {
  rigId: string
  rigName: string
  preservation: 'cria'
  observedAt: string
  status: ArchiveHealthStatus
  obligations: ArchiveObligationsView
  destination: ArchiveDestinationView
  source: ArchiveSourceView
  /**
   * Most recent first. `total` counts every open issue; `needsAttention` only those Vela cannot
   * resolve by retrying (mismatches, conflicts, unvouched copies, missing or quarantined at Cria).
   */
  issues: { total: number; needsAttention: number; shown: ArchiveIssue[] }
  forecast: ArchiveForecastView
  /** A requested reconciliation is running. */
  reconciling: boolean
}

/** ALPACA rigs: Vela does not take custody of their originals. */
export interface UnarchivedRigHealthView {
  rigId: string
  rigName: string
  preservation: 'none'
}

export type ArchiveHealthView = CriaArchiveHealthView | UnarchivedRigHealthView
