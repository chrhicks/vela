import { appendFile, mkdir, rename, rm, stat, truncate } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node'

interface TraceFileOptions {
  maxFileBytes?: number
  retainedFiles?: number
  maxPendingBytes?: number
  onError?: (error: Error) => void
  appendFile?: typeof appendFile
  now?: () => number
}

const retryDelaysMs = [5_000, 30_000, 60_000]

export type TraceHealth =
  | { readonly state: 'off' }
  | {
      readonly state: 'ok' | 'failing'
      readonly dropped: number
      readonly lastWriteAt: number | null
      readonly lastError: { readonly at: number; readonly message: string } | null
    }

export interface TraceFileExporter extends SpanExporter {
  health(): Extract<TraceHealth, { state: 'ok' | 'failing' }>
}

const backingOff = new Error('Trace writer is backing off after a write failure; spans were dropped')

/** One process owns this journal. Completed spans are readable during a run;
 * an unfinished parent does not hold back its completed children. */
export function createTraceFileExporter(
  path: string,
  {
    maxFileBytes = 20 * 1024 * 1024,
    retainedFiles = 5,
    maxPendingBytes = 4 * 1024 * 1024,
    onError = error => console.error('Vela tracing:', error.message),
    appendFile: append = appendFile,
    now = Date.now,
  }: TraceFileOptions = {},
): TraceFileExporter {
  if (
    ![maxFileBytes, retainedFiles, maxPendingBytes].every(
      value => Number.isSafeInteger(value) && value > 0,
    )
  ) {
    throw new Error('Trace file limits must be positive integers')
  }

  const file = resolve(path)
  let pending = Promise.resolve()
  let pendingBytes = 0
  let fileBytes = 0
  let committedBytes: number | undefined
  let initialized = false
  let closed = false
  let failures = 0
  let retryAt = 0
  let dropped = 0
  let lastWriteAt: number | null = null
  let lastError: { at: number; message: string } | null = null
  let reported = false

  const isBackingOff = () => failures > 0 && now() < retryAt

  function fail(error: Error) {
    failures++
    retryAt = now() + retryDelaysMs[Math.min(failures, retryDelaysMs.length) - 1]!
    lastError = { at: now(), message: error.message }
    initialized = false
    report(error)
  }

  function succeed() {
    failures = 0
    reported = false
    lastWriteAt = now()
  }

  function report(error: Error) {
    if (reported) return
    reported = true

    // Diagnostics must never turn into a device-operation failure.
    try {
      onError(error)
    } catch {}
  }

  async function write(lines: string[]) {
    if (!initialized) {
      await mkdir(dirname(file), { recursive: true })

      const size = await stat(file).then(
        info => info.size,
        error => {
          if (error.code === 'ENOENT') return 0
          throw error
        },
      )
      committedBytes ??= size

      if (size > committedBytes) await truncate(file, committedBytes)

      fileBytes = Math.min(size, committedBytes)
      initialized = true
    }

    let chunk = ''

    async function flushChunk() {
      if (!chunk) return
      await append(file, chunk, { mode: 0o600 })
      chunk = ''
      committedBytes = fileBytes
    }

    for (const line of lines) {
      const size = Buffer.byteLength(line)

      if (fileBytes + size > maxFileBytes) {
        await flushChunk()

        for (let index = retainedFiles - 1; index >= 1; index--) {
          if (index === retainedFiles - 1) await rm(`${file}.${index}`, { force: true })

          if (index > 1) {
            await rename(`${file}.${index - 1}`, `${file}.${index}`).catch(error => {
              if (error.code !== 'ENOENT') throw error
            })
          }
        }

        if (retainedFiles > 1) {
          await rename(file, `${file}.1`).catch(error => {
            if (error.code !== 'ENOENT') throw error
          })
        } else {
          await rm(file, { force: true })
        }

        fileBytes = 0
        committedBytes = 0
      }

      chunk += line
      fileBytes += size
    }

    await flushChunk()
  }

  return {
    export(spans, callback) {
      const reject = (error: Error) => {
        dropped += spans.length

        if (error !== backingOff) report(error)
        callback({ code: ExportResultCode.FAILED, error })
      }

      if (closed) return reject(new Error('Trace exporter is closed'))

      if (isBackingOff()) return reject(backingOff)
      let lines: string[]

      try {
        lines = spans.map(span => JSON.stringify(traceRecord(span)) + '\n')
      } catch (cause) {
        return reject(asError(cause))
      }

      const bytes = lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0)

      if (lines.some(line => Buffer.byteLength(line) > maxFileBytes))
        return reject(new Error('Trace record exceeds file size limit'))

      if (pendingBytes + bytes > maxPendingBytes)
        return reject(new Error('Trace writer queue is full; spans were dropped'))
      pendingBytes += bytes

      const task = pending.then(async () => {
        if (isBackingOff()) throw backingOff
        await write(lines)
      })

      pending = task.then(succeed, cause => {
        if (cause !== backingOff) fail(asError(cause))
      })
      void task.then(
        () => finish({ code: ExportResultCode.SUCCESS }),
        cause => {
          dropped += spans.length
          finish({ code: ExportResultCode.FAILED, error: asError(cause) })
        },
      )

      function finish(result: ExportResult) {
        pendingBytes -= bytes
        callback(result)
      }
    },
    health: () => ({
      state: failures > 0 ? 'failing' : 'ok',
      dropped,
      lastWriteAt,
      lastError,
    }),
    async shutdown() {
      closed = true
      await pending
    },
    async forceFlush() {
      await pending
    },
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function unixNanoseconds(time: readonly [number, number]) {
  return (BigInt(time[0]) * 1_000_000_000n + BigInt(time[1])).toString()
}

function isoTime(time: readonly [number, number]) {
  return new Date(time[0] * 1000 + time[1] / 1e6).toISOString()
}

function traceRecord(span: ReadableSpan) {
  const identity = span.spanContext()

  return {
    type: 'span',
    name: span.name,
    traceId: identity.traceId,
    spanId: identity.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    startTime: isoTime(span.startTime),
    endTime: isoTime(span.endTime),
    startTimeUnixNano: unixNanoseconds(span.startTime),
    endTimeUnixNano: unixNanoseconds(span.endTime),
    durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
    kind: span.kind,
    status: span.status,
    attributes: span.attributes,
    resource: span.resource.attributes,
    scope: span.instrumentationScope,
    events: span.events.map(event => ({ ...event, time: isoTime(event.time) })),
    links: span.links,
    droppedAttributes: span.droppedAttributesCount,
    droppedEvents: span.droppedEventsCount,
    droppedLinks: span.droppedLinksCount,
  }
}

/** SDK ownership belongs to the server bootstrap; importing the API elsewhere
 * remains a no-op when local tracing is not configured. */
export function startTelemetry(path: string | undefined) {
  if (!path?.trim())
    return {
      shutdown: async () => {},
      forceFlush: async () => {},
      health: (): TraceHealth => ({ state: 'off' }),
    }
  const exporter = createTraceFileExporter(path)

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'vela-server', 'process.pid': process.pid }),
    spanLimits: { attributeCountLimit: 64, attributeValueLengthLimit: 1024, eventCountLimit: 64 },
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 1000,
        maxQueueSize: 2048,
        maxExportBatchSize: 128,
        exportTimeoutMillis: 2000,
      }),
    ],
  })

  provider.register()

  return {
    forceFlush: () => provider.forceFlush(),
    health: (): TraceHealth => exporter.health(),
    async shutdown() {
      let timeout: ReturnType<typeof setTimeout> | undefined

      try {
        await Promise.race([
          provider.shutdown(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Trace shutdown timed out')), 5000)
          }),
        ])
      } catch (error) {
        console.error('Vela tracing shutdown:', asError(error).message)
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    },
  }
}
