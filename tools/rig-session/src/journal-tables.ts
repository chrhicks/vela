import { linkToAttempt, linkToOperation, type Link } from './joins.ts'
import type { JournalEntry, JournalExchange, JournalImageCheck } from './journal.ts'
import type { FrameRecord } from './inputs.ts'
import type { RecordedOperation } from './recording.ts'
import type { CriaImageCheckRow, CriaRequestRow } from './schema.ts'
import { z } from 'zod'

const answeredBody = z.looseObject({ id: z.string().optional() })

/** The operation a route names: `/v2/operations/<id>` and what hangs off it. */
const routedOperation = (route: string) => /^\/v2\/operations\/([^/?]+)/.exec(route)?.[1] ?? null

export interface JournalRows {
  readonly requests: readonly CriaRequestRow[]
  readonly imageChecks: readonly CriaImageCheckRow[]
  /** What the exported rows link to, so the tables they link to export them too. */
  readonly linkedAttempts: readonly FrameRecord[]
  readonly linkedOperations: readonly RecordedOperation[]
}

const targets = <Target>(link: Link<Target> | null): readonly Target[] => (link === null ? [] : link.kind === 'ambiguous' ? link.candidates : [link.target])

const attemptColumns = (link: Link<FrameRecord> | null) => {
  const only = link?.kind === 'ambiguous' ? null : (link?.target ?? null)

  return {
    run_id: only?.runId ?? null,
    attempt: only?.attempt ?? null,
    attempt_link: link?.kind ?? null,
    attempt_candidates: link?.kind === 'ambiguous' ? JSON.stringify(link.candidates.map(record => `${record.runId}/${record.attempt}`)) : null,
  }
}

const operationColumns = (link: Link<RecordedOperation> | null) => ({
  operation_link: link?.kind ?? null,
  operation_candidates: link?.kind === 'ambiguous' ? JSON.stringify(link.candidates.map(operation => operation.id)) : null,
})

/** The journal rows that start in the window, each linked by the ids it carries. */
export function journalRows(
  session: string,
  entries: readonly JournalEntry[],
  inWindow: (time: Date) => boolean,
  records: readonly FrameRecord[],
  operations: readonly RecordedOperation[],
): JournalRows {
  const requests = entries.filter((entry): entry is JournalExchange => entry.kind === 'exchange' && inWindow(entry.at))
  const checks = entries.filter((entry): entry is JournalImageCheck => entry.kind === 'image' && inWindow(entry.at))

  const requestLinks = requests.map(request => {
    const body = request.reply.kind === 'answered' ? answeredBody.safeParse(request.reply.body) : null
    const operationId = (body?.success ? body.data.id : undefined) ?? routedOperation(request.route)
    const requestId = request.command?.requestId ?? null

    return {
      operationId,
      operation: operationId === null && requestId === null ? null : linkToOperation({ operationId, requestId }, operations),
      attempt: requestId === null ? null : linkToAttempt({ requestId }, records),
    }
  })

  const checkLinks = checks.map(check => ({
    operation: linkToOperation({ operationId: check.operationId, requestId: null }, operations),
    attempt: linkToAttempt({ criaImageId: check.imageId }, records),
  }))

  return {
    requests: requests.map((request, index) => {
      const { operationId, operation, attempt } = requestLinks[index] ?? { operationId: null, operation: null, attempt: null }

      return {
        session,
        at: request.at,
        ms: request.ms,
        method: request.method,
        route: request.route,
        status: request.status,
        request_id: request.command?.requestId ?? null,
        device_id: request.command?.deviceId ?? null,
        kind: request.command?.kind ?? null,
        parameters: request.command ? JSON.stringify(request.command.parameters ?? null) : null,
        reply_kind: request.reply.kind,
        reply_code: request.reply.kind === 'refused' ? request.reply.code : null,
        reply_message: request.reply.kind === 'answered' ? null : request.reply.message,
        operation_id: operationId,
        ...operationColumns(operation),
        ...attemptColumns(attempt),
      }
    }),
    imageChecks: checks.map((check, index) => {
      const { operation, attempt } = checkLinks[index] ?? { operation: null, attempt: null }
      const exact = operation?.kind === 'exact' ? operation.target : null
      const recorded = exact?.outcome.value?.image?.sha256

      return {
        session,
        at: check.at,
        image_id: check.imageId,
        operation_id: check.operationId,
        bytes: check.bytes,
        sha256: check.sha256,
        verdict: check.verdict,
        sha_matches_operation: recorded === undefined ? null : recorded === check.sha256,
        ...operationColumns(operation),
        ...attemptColumns(attempt),
      }
    }),
    linkedAttempts: [...requestLinks, ...checkLinks].flatMap(({ attempt }) => targets(attempt)),
    linkedOperations: [...requestLinks, ...checkLinks].flatMap(({ operation }) => targets(operation)),
  }
}
