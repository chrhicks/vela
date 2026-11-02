import { mkdir, open, readdir, unlink, type FileHandle } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { encodeEvent, epochMs, seal, type RigEvent, type RigId, type SourceId } from '@vela/rig-events'

/**
 * Sizing, from one measured snapshot. The largest `cria.state` line in the recorded journals of 2026-11-01
 * was 38,063 bytes (median 34,277), so a snapshot is counted as 40 KiB.
 *
 * - One snapshot a second is 3,600 x 40 KiB = 141 MiB an hour, 43,200 x 40 KiB = 1.65 GiB for a 12 hour
 *   night and 3.30 GiB for a whole day.
 * - A 256 MiB file holds 6,553 snapshots, 1 h 49 min. A night is 7 files and a night never reaches a cap,
 *   because the cap is on one file, not on the run. The journal that stopped on 2026-10-25 had one cap for
 *   the whole process.
 * - 96 files keep 24 GiB: 14 twelve-hour nights, or 7 days around the clock, for 14% of the 172 GiB free
 *   on thuban when this was written.
 * - 64 MiB queued rides out a 27 minute stall (1,638 snapshots) before events are dropped.
 */
export const defaultMaxFileBytes = 256 * 1024 * 1024

export const defaultMaxFiles = 96

export const defaultMaxPendingBytes = 64 * 1024 * 1024

const batchBytes = 1024 * 1024

export interface RunLogOptions {
  readonly directory: string
  /** A file past this size is closed and the next write starts a new one. */
  readonly maxFileBytes?: number
  /** Run files kept in the directory, this run's included. Older ones are deleted. */
  readonly maxFiles?: number
  /** Encoded events waiting for the disk. Past this, new events are dropped and counted. */
  readonly maxPendingBytes?: number
  /** Wait before a failed write is tried again: it doubles from `firstMs` to `lastMs`. */
  readonly retry?: { readonly firstMs: number; readonly lastMs: number }
  /** How long `close` waits for the disk before it gives up on what is still queued. */
  readonly closeTimeoutMs?: number
  readonly now?: () => number
  /** Opens a new file for appending; replaceable so a test can fill the disk. */
  readonly openFile?: typeof open
  /** Called once per failing episode, and for a trim that failed. */
  readonly onProblem?: (message: string) => void
}

export interface RunLogHealth {
  /** `retrying`: the last write failed and the log keeps trying; nothing is lost until the queue is full. */
  readonly state: 'ok' | 'retrying' | 'closed'
  readonly file: string | null
  readonly writtenBytes: number
  readonly pendingBytes: number
  /** Events lost to a full queue since the process started. A `gap` event in the log says when. */
  readonly dropped: number
  readonly lastWriteAt: number | null
  readonly lastError: { readonly at: number; readonly message: string } | null
}

export interface RunLog {
  /** Returns at once and never throws. */
  append(event: RigEvent): void
  health(): RunLogHealth
  close(): Promise<void>
}

interface Lost {
  readonly rig: RigId
  readonly source: SourceId
  readonly from: number
  count: number
}

const runFile = /^run-\d{8}T\d{9}Z-\d{5,}\.jsonl$/

function fileName(startedAt: number, part: number) {
  return `run-${new Date(startedAt).toISOString().replace(/[-:.]/g, '')}-${String(part).padStart(5, '0')}.jsonl`
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A catch clause hands over any thrown value.
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Appends `rig-events` envelopes, one canonical JSON line each, to one file per run in `directory`, and starts
 * a new file at `maxFileBytes`. A write that fails closes its file, so a torn line is only ever the last in
 * a file, and is tried again in a new one. The log never switches itself off: events wait in a bounded queue,
 * and what the queue cannot hold is counted and recorded as a `gap` event once the disk takes writes again.
 */
export function openRunLog({
  directory,
  maxFileBytes = defaultMaxFileBytes,
  maxFiles = defaultMaxFiles,
  maxPendingBytes = defaultMaxPendingBytes,
  retry = { firstMs: 1_000, lastMs: 30_000 },
  closeTimeoutMs = 2_000,
  now = Date.now,
  openFile = open,
  onProblem = message => console.error('Vela run log:', message),
}: RunLogOptions): RunLog {
  const startedAt = now()
  const queue: string[] = []
  const lost = new Map<string, Lost>()
  let pendingBytes = 0
  let dropped = 0
  let written = 0
  let lastWriteAt: number | null = null
  let lastError: RunLogHealth['lastError'] = null
  let failing = false
  let closing = false
  let part = 0
  let handle: FileHandle | undefined
  let path = ''
  let fileBytes = 0
  let running = false
  let gaveUp = false
  let working: Promise<void> = Promise.resolve()
  let wake = () => {}

  function lose(event: RigEvent) {
    const key = `${event.rig}|${event.source}`
    const known = lost.get(key)

    dropped += 1

    if (known) known.count += 1
    else lost.set(key, { rig: event.rig, source: event.source, from: now(), count: 1 })
  }

  function enqueue(line: string) {
    queue.push(line)
    pendingBytes += Buffer.byteLength(line)
  }

  /** Turns what the queue dropped into `gap` events, once the queue is empty again. */
  function recordGaps() {
    const at = epochMs(Math.round(now()))

    for (const { rig, source, from, count } of lost.values())
      enqueue(`${encodeEvent(seal({ kind: 'gap', rig, source, at: epochMs(Math.round(from)), seenAt: at, body: { source, from: epochMs(Math.round(from)), to: at, reason: 'disk', dropped: count } }))}\n`)

    lost.clear()
  }

  async function trim() {
    try {
      const others = (await readdir(directory)).filter(name => runFile.test(name) && name !== basename(path)).sort()

      for (const old of others.slice(0, Math.max(0, others.length - (maxFiles - 1)))) await unlink(join(directory, old))
    } catch (error) {
      onProblem(`Could not trim old files: ${messageOf(error)}`)
    }
  }

  async function startFile() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    part += 1

    const next = join(directory, fileName(startedAt, part))

    handle = await openFile(next, 'ax', 0o600)
    path = next
    fileBytes = 0
    await trim()
  }

  async function endFile() {
    const old = handle

    handle = undefined
    await old?.close()
  }

  async function write(text: string, bytes: number) {
    if (handle && fileBytes > 0 && fileBytes + bytes > maxFileBytes) await endFile()

    if (!handle) await startFile()
    await handle?.appendFile(text)
    fileBytes += bytes
    written += bytes
    lastWriteAt = now()
  }

  async function abandonFile() {
    const old = handle
    const torn = fileBytes === 0

    handle = undefined
    await old?.close().catch(() => {})

    if (old && torn) await unlink(path).catch(() => {})
  }

  function pause(ms: number) {
    return new Promise<void>(resolve => {
      const timer = setTimeout(resolve, ms)

      timer.unref()

      wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  async function drain() {
    let wait = retry.firstMs

    try {
      while (true) {
        if (gaveUp) return await endFile().catch(() => {})

        if (queue.length === 0 && lost.size > 0) recordGaps()

        if (queue.length === 0) return

        let count = 0
        let bytes = 0

        while (count < queue.length && (count === 0 || bytes < batchBytes)) {
          bytes += Buffer.byteLength(queue[count] ?? '')
          count += 1
        }

        try {
          await write(queue.slice(0, count).join(''), bytes)
          queue.splice(0, count)
          pendingBytes -= bytes
          failing = false
          wait = retry.firstMs
        } catch (error) {
          await abandonFile()
          lastError = { at: now(), message: messageOf(error) }

          if (!failing) onProblem(`${lastError.message}; trying again in a new file`)
          failing = true

          if (closing) return
          await pause(wait)
          wait = Math.min(wait * 2, retry.lastMs)
        }
      }
    } finally {
      running = false
    }
  }

  return {
    append(event) {
      if (closing) return
      let line: string

      try {
        line = `${encodeEvent(event)}\n`
      } catch {
        return lose(event)
      }

      if (pendingBytes + Buffer.byteLength(line) > maxPendingBytes) return lose(event)
      enqueue(line)

      if (running) return
      running = true

      working = drain().catch(error => {
        lastError = { at: now(), message: messageOf(error) }
        failing = true
      })
    },
    health: () => ({
      state: closing ? 'closed' : failing ? 'retrying' : 'ok',
      file: path === '' ? null : basename(path),
      writtenBytes: written,
      pendingBytes,
      dropped,
      lastWriteAt,
      lastError,
    }),
    async close() {
      if (closing) return
      closing = true
      wake()

      let timer: NodeJS.Timeout | undefined

      const drained = await Promise.race([
        working.then(() => true),
        new Promise<boolean>(resolve => {
          timer = setTimeout(resolve, closeTimeoutMs, false)
        }),
      ])

      clearTimeout(timer)

      if (drained) return endFile().catch(() => {})

      gaveUp = true
      lastError = { at: now(), message: `The disk stalled while closing; ${queue.length} queued events were not written` }
      onProblem(lastError.message)
    },
  }
}
