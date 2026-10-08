import type { CriaArchiveHealthView } from '@vela/model/web'

// Relative to when the preview loads, so ages read naturally in every scenario.
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const at = ago(0)

const frame = 104_368_428

/** A healthy store after a night of full-size frames; scenarios override what differs. */
export function health(overrides: Partial<CriaArchiveHealthView> = {}): CriaArchiveHealthView {
  return {
    rigId: 'fra400',
    rigName: 'Askar FRA 400',
    preservation: 'cria',
    observedAt: at,
    status: 'current',
    obligations: {
      arriving: { count: 0, bytes: 0 },
      waitingAtCria: { count: 0, bytes: 0 },
      unverified: { count: 0, bytes: 0 },
      acknowledgementPending: { count: 0, bytes: 0 },
      preserved: { count: 42, bytes: 42 * frame },
      archiveCountedAt: at,
      complete: true,
    },
    destination: {
      location: '/srv/vela/acquisitions',
      state: 'available',
      problem: null,
      intentRefusal: null,
      lastPreservedAt: at,
      space: { freeBytes: 812e9, totalBytes: 2e12, measuredPath: '/srv/vela/acquisitions', basis: 'opened-archive' },
    },
    source: {
      storeId: '5f0c1a52-31f3-4bd6-a0c1-6d2f3f7d9a10',
      observedAt: at,
      current: true,
      error: null,
      capacity: {
        committedBytes: 0,
        budgetBytes: 2 ** 31,
        reservationBytes: 160_000_044,
        freeBytes: 84e9,
        freeSpaceReserveBytes: 1_048_576,
        outstandingRecords: 0,
        recordLimit: 10_000,
        captureAdmissible: true,
        refusal: null,
      },
      releaseAfterReceipt: true,
      extraCopies: { count: 0, bytes: 0 },
      quarantined: { count: 0, bytes: 0 },
      missing: { count: 0, complete: true },
    },
    issues: { total: 0, shown: [] },
    forecast: {
      frameBytes: { bytes: frame, observedAt: at },
      rate: { framesPerHour: 18, frames: 10, since: ago(30) },
      rateUnknown: null,
      backlogBytes: 0,
      destinationHours: 432,
      criaCapturesBeforeRefusal: 19,
      totalRequirement: 'unknown',
    },
    reconciling: false,
    ...overrides,
  }
}

const base = health()

export const scenarios = {
  preserved: health(),
  arriving: health({ obligations: { ...base.obligations, arriving: { count: 1, bytes: frame } } }),
  acknowledgement: health({
    status: 'catching-up',
    obligations: { ...base.obligations, acknowledgementPending: { count: 1, bytes: frame } },
    issues: {
      total: 1,
      shown: [{
        imageId: '0c6b2a1e-6f43-4d0e-9a55-1b8a3c2f7e90',
        reason: 'acknowledgement-pending',
        detail: 'Cria has not confirmed the receipt: Cria request did not complete',
        observedAt: at,
        requestId: null,
        operationId: '5a1f3c9e-2b7d-4e60-8c1a-9f4d2e6b7a31',
        purpose: 'capture',
      }],
    },
  }),
  unavailable: health({
    status: 'degraded',
    obligations: { ...base.obligations, waitingAtCria: { count: 6, bytes: 6 * frame } },
    destination: {
      ...base.destination,
      state: 'unavailable',
      problem: { kind: 'write-failed', detail: 'No space left on the archive disk', observedAt: at },
      space: { freeBytes: 4e6, totalBytes: 2e12, measuredPath: '/srv/vela/acquisitions', basis: 'opened-archive' },
    },
    source: { ...base.source, capacity: { ...base.source.capacity!, committedBytes: 6 * frame, outstandingRecords: 6 } },
    forecast: { ...base.forecast, backlogBytes: 6 * frame, destinationHours: null, criaCapturesBeforeRefusal: 13 },
  }),
  capacityFull: health({
    status: 'degraded',
    obligations: { ...base.obligations, waitingAtCria: { count: 19, bytes: 19 * frame } },
    destination: {
      ...base.destination,
      state: 'unavailable',
      problem: { kind: 'missing', detail: 'The archive folder no longer exists. Its disk may be unmounted.', observedAt: at },
      space: { freeBytes: 41e9, totalBytes: 64e9, measuredPath: '/srv', basis: 'other-location' },
    },
    source: {
      ...base.source,
      capacity: {
        ...base.source.capacity!,
        committedBytes: 19 * frame,
        outstandingRecords: 19,
        captureAdmissible: false,
        refusal: 'Image budget full: 1983000132 of 2147483648 bytes committed, 160000044 needed; originals are retained until archive receipts',
      },
    },
    forecast: { ...base.forecast, rate: null, rateUnknown: 'not-acquiring', backlogBytes: 19 * frame, destinationHours: null, criaCapturesBeforeRefusal: 0 },
  }),
  intentRefused: health({
    destination: { ...base.destination, intentRefusal: { at, detail: 'The archive disk is read-only' } },
  }),
  attention: health({
    status: 'attention',
    source: { ...base.source, quarantined: { count: 1, bytes: 52_184_214 } },
    issues: {
      total: 2,
      shown: [
        {
          imageId: '8d2e4f6a-1c3b-4a5d-9e7f-0b1c2d3e4f50',
          reason: 'quarantined-at-cria',
          detail: 'Partial original without a verified completion record. Driver worker process has exited',
          observedAt: at,
          requestId: 'capture-8d2e4f6a',
          operationId: '1e2d3c4b-5a69-4788-9a0b-c1d2e3f4a5b6',
          purpose: null,
        },
        {
          imageId: '3b4c5d6e-7f80-4192-a3b4-c5d6e7f8a9b0',
          reason: 'original-mismatch',
          detail: 'Archived original differs from the Cria source',
          observedAt: at,
          requestId: null,
          operationId: null,
          purpose: 'autofocus',
        },
      ],
    },
  }),
  stale: health({
    status: 'unknown',
    source: { ...base.source, current: false, error: 'Cria request did not complete', observedAt: ago(8) },
    obligations: { ...base.obligations, complete: false },
  }),
} satisfies Record<string, CriaArchiveHealthView>

export type ScenarioName = keyof typeof scenarios
