import type { State } from '@cria/wire'

/** How one exchange with Cria ended, as the client decoded it. */
export type JournalReply =
  | { readonly kind: 'answered'; readonly body: unknown }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }
  | { readonly kind: 'lost'; readonly message: string }

export type JournalEntry =
  | {
      readonly kind: 'exchange'
      readonly at: number
      readonly ms: number
      readonly method: 'GET' | 'POST'
      readonly route: string
      /** The HTTP status, or null when no response arrived. */
      readonly status: number | null
      /** What Vela asked of a device, when the request was an operation. */
      readonly command: { readonly requestId: string; readonly deviceId: string; readonly kind: string; readonly parameters: unknown } | null
      readonly reply: JournalReply
    }
  | {
      /** Whether a fetched original matched the size and digest its descriptor promised. The bytes are never kept. */
      readonly kind: 'image'
      readonly at: number
      readonly imageId: string
      readonly operationId: string
      readonly bytes: number
      readonly sha256: string
      readonly verdict: 'intact' | 'damaged' | 'gone' | 'failed'
    }
  | {
      /** Every snapshot that arrives, whole, with the time Vela received it. */
      readonly kind: 'state'
      readonly at: number
      readonly state: State
    }
  | { readonly kind: 'stream'; readonly at: number; readonly event: 'opened' | 'ended'; readonly message: string | null }

/** What the client writes. The connection adds the origin before it reaches a sink. */
export interface Journal {
  record(entry: JournalEntry): void
}

/** Where a connection's entries go. `record` returns at once and never throws; an entry it cannot keep is dropped. */
export interface JournalSink {
  record(entry: JournalEntry & { readonly origin: string }): void
}

export const noJournal: Journal = { record() {} }
