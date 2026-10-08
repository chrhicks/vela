import { describe, expect, it } from 'vitest'
import type { CriaArchiveHealthView } from '@vela/model/web'
import { formatBytes, preservationSummary } from './presentation'
import { isArchiveHealthView } from './validation'

const at = '2026-10-08T22:00:00.000Z'

function view(overrides: Partial<CriaArchiveHealthView> = {}): CriaArchiveHealthView {
  return {
    rigId: 'fra400',
    rigName: 'FRA 400',
    preservation: 'cria',
    observedAt: at,
    status: 'current',
    obligations: {
      arriving: { count: 0, bytes: 0 },
      waitingAtCria: { count: 0, bytes: 0 },
      unverified: { count: 0, bytes: 0 },
      acknowledgementPending: { count: 0, bytes: 0 },
      preserved: { count: 12, bytes: 12 * 104_368_428 },
      archiveCountedAt: at,
      complete: true,
    },
    destination: {
      location: '/srv/vela/acquisitions',
      state: 'available',
      problem: null,
      intentRefusal: null,
      lastPreservedAt: at,
      space: { freeBytes: 900e9, totalBytes: 2e12, measuredPath: '/srv/vela/acquisitions', basis: 'opened-archive' },
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
        freeBytes: 80e9,
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
      frameBytes: null,
      rate: null,
      rateUnknown: 'too-few-acquisitions',
      backlogBytes: 0,
      destinationHours: null,
      criaCapturesBeforeRefusal: null,
      totalRequirement: 'unknown',
    },
    reconciling: false,
    ...overrides,
  }
}

describe('preservation wording', () => {
  it('distinguishes a pending acknowledgement from a lost image and from an unavailable archive', () => {
    const pending = view({
      status: 'catching-up',
      obligations: { ...view().obligations, acknowledgementPending: { count: 1, bytes: 104_368_428 } },
    })

    expect(preservationSummary(pending, true)).toMatchObject({
      tone: 'pending',
      explanation: 'Capturing · 1 original verified, waiting for Cria to confirm. Vela finishes this automatically.',
      nextStep: null,
    })

    const unavailable = view({
      status: 'degraded',
      obligations: { ...view().obligations, waitingAtCria: { count: 6, bytes: 6 * 104_368_428 } },
      destination: {
        ...view().destination,
        state: 'unavailable',
        problem: { kind: 'missing', detail: 'The archive folder no longer exists. Its disk may be unmounted.', observedAt: at },
      },
    })

    expect(preservationSummary(unavailable, false)).toMatchObject({
      tone: 'problem',
      explanation:
        '6 originals waiting for archive. The Vela archive cannot accept originals: The archive folder no longer exists. ' +
        'Its disk may be unmounted. Cria is retaining them until they can be archived.',
      nextStep: 'Reconnect or mount the archive disk, then check the archive.',
    })
  })

  it('does not claim preservation is current when Cria cannot be read', () => {
    const stale = view({ status: 'unknown', source: { ...view().source, current: false, error: 'Cria is unreachable' } })

    expect(preservationSummary(stale, true)).toMatchObject({
      tone: 'unknown',
      title: 'Preservation status unknown',
      explanation: "Capturing · Cria's custody could not be read: Cria is unreachable. Last known totals are shown with their age.",
    })
  })

  it('says when a problem summary rests on last-known Cria facts', () => {
    const stale = view({ status: 'degraded', source: { ...view().source, current: false, error: 'Cria request did not complete' } })

    expect(preservationSummary(stale, false).explanation).toMatch(/Cria could not be read just now; its totals are last known\.$/)
  })

  it('says the archive is still being counted rather than guessing its totals', () => {
    const counting = view({
      status: 'unknown',
      obligations: { ...view().obligations, unverified: null, acknowledgementPending: null, preserved: null, archiveCountedAt: null, complete: false },
    })

    expect(preservationSummary(counting, false)).toMatchObject({
      tone: 'unknown',
      explanation: 'Vela is still counting its archive, so it cannot yet say every original is preserved.',
    })
  })

  it('formats measured bytes plainly', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(104_368_428)).toBe('104 MB')
    expect(formatBytes(1_520_000_000)).toBe('1.5 GB')
  })
})

describe('archive health validation', () => {
  it('accepts a coherent view for this rig only', () => {
    expect(isArchiveHealthView(view(), 'fra400')).toBe(true)
    expect(isArchiveHealthView(view(), 'seestar')).toBe(false)
    expect(isArchiveHealthView({ rigId: 'seestar', rigName: 'Seestar', preservation: 'none' }, 'seestar')).toBe(true)
  })

  it('refuses contradictory or malformed facts', () => {
    const rate = { framesPerHour: 20, frames: 4, since: at }

    expect(isArchiveHealthView(view({ forecast: { ...view().forecast, rate } }), 'fra400')).toBe(false)
    expect(isArchiveHealthView(view({ issues: { total: 0, shown: [{ imageId: 'a', reason: 'missing-at-cria', detail: 'gone', observedAt: at, requestId: null, operationId: null, purpose: null }] } }), 'fra400')).toBe(false)
    expect(isArchiveHealthView({ ...view(), obligations: { ...view().obligations, preserved: { count: -1, bytes: 0 } } }, 'fra400')).toBe(false)
  })
})
