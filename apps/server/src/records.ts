import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface JsonlRecords<Record> {
  /** Returns at once. A record that cannot be written is dropped, never raised to the caller. */
  append(record: Record): void
  close(): Promise<void>
}

export const noRecords: JsonlRecords<never> = {
  append() {},
  async close() {},
}

interface JsonlRecordOptions {
  /** What the file holds, in plain words, for the messages: "frame records". */
  name: string
  maxPendingBytes?: number
  onError?: (error: Error) => void
}

/**
 * Appends one JSON line per record. The first failure, or a backlog above `maxPendingBytes`,
 * switches recording off until the server restarts, so a line is never half written in the
 * middle of the file.
 */
export function openJsonlRecords<Record>(
  path: string,
  {
    name,
    maxPendingBytes = 1024 * 1024,
    onError = error => console.error(`Vela ${name}:`, error.message),
  }: JsonlRecordOptions,
): JsonlRecords<Record> {
  const file = resolve(path)
  let pending = Promise.resolve()
  let pendingBytes = 0
  let off = false

  function latchOff(error: Error) {
    if (off) return
    off = true
    pendingBytes = 0

    try {
      onError(error)
    } catch {}
  }

  return {
    append(record) {
      if (off) return
      const line = `${JSON.stringify(record)}\n`
      const size = Buffer.byteLength(line)

      if (pendingBytes + size > maxPendingBytes)
        return latchOff(new Error(`Writing fell behind; ${name} are off until restart`))

      pendingBytes += size

      pending = pending
        .then(async () => {
          if (off) return
          await mkdir(dirname(file), { recursive: true })
          await appendFile(file, line, { mode: 0o600 })
        })
        .catch(error => latchOff(error instanceof Error ? error : new Error(String(error))))
        .finally(() => {
          if (!off) pendingBytes -= size
        })
    },
    close: () => pending,
  }
}
