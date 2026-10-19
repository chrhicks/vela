import { appendFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { State } from '@cria/wire'

/** A decoded wire value: JSON, with nothing in it that a journal line cannot hold. */
export type JournalValue = string | number | boolean | null | ReadonlyArray<JournalValue> | { readonly [key: string]: JournalValue }

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
      /** `changed` holds only the cells that differ from the previous state entry, keyed like `device/<id>/readings.<field>`. */
      readonly kind: 'state'
      readonly at: number
      readonly generatedAt: number
      readonly sequence: number
      readonly instanceId: string
      readonly commandsEnabled: boolean
      readonly baseline: boolean
      readonly changed: Readonly<Record<string, JournalValue>>
      readonly removed: ReadonlyArray<string>
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

export interface ClosableJournalSink extends JournalSink {
  close(): Promise<void>
}

export const noJournal: Journal = { record() {} }

interface JournalFileOptions {
  /** Serialized entries waiting for the disk. */
  readonly maxPendingBytes?: number
  /** Size the file may reach, counting what it held when the process opened it. */
  readonly maxFileBytes?: number
  readonly onError?: (error: Error) => void
}

/**
 * Appends one JSON line per entry. The first write failure, a backlog above `maxPendingBytes` or
 * `maxFileBytes` in the file turns it off until the process restarts, so a line is never half written
 * in the middle of the file and a slow disk never holds memory or delays the client.
 */
export function openJournalFile(
  path: string,
  {
    maxPendingBytes = 4 * 1024 * 1024,
    maxFileBytes = 256 * 1024 * 1024,
    onError = error => console.error('Vela Cria journal:', error.message),
  }: JournalFileOptions = {},
): ClosableJournalSink {
  const file = resolve(path)
  let pending = Promise.resolve()
  let pendingBytes = 0
  let writtenBytes = 0
  let sized = false
  let off = false

  function latchOff(reason: string) {
    if (off) return
    off = true
    pendingBytes = 0

    try {
      onError(new Error(reason))
    } catch {}
  }

  return {
    record(entry) {
      if (off) return
      let line: string

      try {
        line = `${JSON.stringify(entry)}\n`
      } catch (error) {
        return latchOff(`Could not serialize an entry: ${error instanceof Error ? error.message : String(error)}`)
      }

      const size = Buffer.byteLength(line)

      if (writtenBytes + pendingBytes + size > maxFileBytes) return latchOff('Reached its size limit; the journal is off until restart')

      if (pendingBytes + size > maxPendingBytes) return latchOff('Writing fell behind; the journal is off until restart')
      pendingBytes += size

      pending = pending
        .then(async () => {
          if (off) return
          await mkdir(dirname(file), { recursive: true })

          if (!sized) {
            writtenBytes = await stat(file).then(
              info => info.size,
              error => (error.code === 'ENOENT' ? 0 : Promise.reject(error)),
            )
            sized = true
          }

          if (writtenBytes + size > maxFileBytes) return latchOff('Reached its size limit; the journal is off until restart')
          await appendFile(file, line, { mode: 0o600 })
          writtenBytes += size
        })
        .catch(error => latchOff(error instanceof Error ? error.message : String(error)))
        .finally(() => {
          if (!off) pendingBytes -= size
        })
    },
    close: () => pending,
  }
}

type Cells = Map<string, { readonly compared: string; readonly cell: JournalValue }>

/**
 * Records each state snapshot as the cells that changed since the last one. A reading's own
 * `observedAt` is not a change, so a mount that tracks steadily writes its sidereal time and little
 * else. Every snapshot still gets a line with its arrival time, so a silent stream shows as a gap.
 */
export function journalStates(journal: Journal): (state: State, arrivedAt: number) => void {
  let previous: Cells | undefined

  return (state, arrivedAt) => {
    const current = cellsOf(state)
    const changed: Record<string, JournalValue> = {}
    const removed: string[] = []

    for (const [key, { compared, cell }] of current) if (previous?.get(key)?.compared !== compared) changed[key] = cell

    if (previous) for (const key of previous.keys()) if (!current.has(key)) removed.push(key)

    journal.record({
      kind: 'state',
      at: arrivedAt,
      generatedAt: state.generatedAt,
      sequence: state.sequence,
      instanceId: state.instanceId,
      commandsEnabled: state.commandsEnabled,
      baseline: previous === undefined,
      changed,
      removed,
    })
    previous = current
  }
}

function cellsOf(state: State): Cells {
  const cells: Cells = new Map()

  function add(key: string, cell: JournalValue) {
    cells.set(key, { compared: JSON.stringify(cell, withoutObservedAt), cell })
  }

  for (const device of state.devices) {
    const { readings, ...rest } = device

    for (const [field, reading] of Object.entries(readings)) add(`device/${device.id}/readings.${field}`, reading)

    for (const [field, value] of Object.entries(rest)) add(`device/${device.id}/${field}`, value)
  }

  for (const operation of state.operations) add(`operation/${operation.id}`, operation)

  return cells
}

function withoutObservedAt(key: string, value: JournalValue) {
  return key === 'observedAt' ? undefined : value
}
