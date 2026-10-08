import { z } from 'zod'
import type { ArchiveHealthView } from '@vela/model/web'

const text = z.string().refine(value => value.trim().length > 0)

const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T.+Z$/)
  .refine(value => Number.isFinite(Date.parse(value)))

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const tally = z.object({ count: amount, bytes: amount })

const purpose = z.enum(['capture', 'autofocus', 'framing', 'alignment']).nullable()

const issue = z.object({
  imageId: text,
  reason: z.enum([
    'source-unavailable',
    'original-mismatch',
    'context-mismatch',
    'receipt-mismatch',
    'acknowledgement-pending',
    'receipt-conflict',
    'unvouched-copy',
    'missing-at-cria',
    'quarantined-at-cria',
  ]),
  detail: text,
  observedAt: timestamp,
  requestId: z.string().nullable(),
  operationId: z.string().nullable(),
  purpose,
})

const destination = z.object({
  location: text,
  state: z.enum(['available', 'unavailable']),
  problem: z
    .object({
      kind: z.enum(['missing', 'replaced', 'not-writable', 'unreadable', 'write-failed']),
      detail: text,
      observedAt: timestamp,
    })
    .nullable(),
  intentRefusal: z.object({ at: timestamp, detail: text }).nullable(),
  lastPreservedAt: timestamp.nullable(),
  space: z
    .object({
      freeBytes: amount,
      totalBytes: amount,
      measuredPath: text,
      basis: z.enum(['opened-archive', 'other-location']),
    })
    .refine(space => space.freeBytes <= space.totalBytes)
    .nullable(),
})

const source = z.object({
  storeId: text,
  observedAt: timestamp.nullable(),
  current: z.boolean(),
  error: text.nullable(),
  capacity: z
    .object({
      committedBytes: amount,
      budgetBytes: amount,
      reservationBytes: amount,
      freeBytes: amount,
      freeSpaceReserveBytes: amount,
      outstandingRecords: amount,
      recordLimit: amount,
      captureAdmissible: z.boolean(),
      refusal: text.nullable(),
    })
    .nullable(),
  releaseAfterReceipt: z.boolean().nullable(),
  extraCopies: tally.nullable(),
  quarantined: tally.nullable(),
  missing: z.object({ count: amount, complete: z.boolean() }).nullable(),
})

const forecast = z.object({
  frameBytes: z.object({ bytes: amount, observedAt: timestamp }).nullable(),
  rate: z
    .object({ framesPerHour: z.number().positive().finite(), frames: amount.min(2), since: timestamp })
    .nullable(),
  rateUnknown: z.enum(['too-few-acquisitions', 'not-acquiring']).nullable(),
  backlogBytes: amount.nullable(),
  destinationHours: z.number().nonnegative().finite().nullable(),
  criaCapturesBeforeRefusal: amount.nullable(),
  totalRequirement: z.literal('unknown'),
})

const criaHealth = z.object({
  rigId: z.string(),
  rigName: text,
  preservation: z.literal('cria'),
  observedAt: timestamp,
  status: z.enum(['degraded', 'attention', 'unknown', 'catching-up', 'current']),
  obligations: z.object({
    waitingAtCria: tally.nullable(),
    unverified: tally.nullable(),
    acknowledgementPending: tally.nullable(),
    preserved: tally.nullable(),
    complete: z.boolean(),
  }),
  destination,
  source,
  issues: z
    .object({ total: amount, shown: z.array(issue) })
    .refine(issues => issues.shown.length <= issues.total),
  forecast,
  reconciling: z.boolean(),
})

const unarchived = z.object({ rigId: z.string(), rigName: text, preservation: z.literal('none') })

const archiveHealth = z.discriminatedUnion('preservation', [criaHealth, unarchived])

export function isArchiveHealthView(value: unknown, rigId: string): value is ArchiveHealthView {
  const result = archiveHealth.safeParse(value)

  if (!result.success || result.data.rigId !== rigId) return false

  const view = result.data

  // A rate is either known or explained, never both.
  return view.preservation === 'none' || (view.forecast.rate === null) !== (view.forecast.rateUnknown === null)
}
