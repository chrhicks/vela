import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { context, propagation, trace } from '@opentelemetry/api'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node'
import { buildApp } from './app.js'
import { createTraceFileExporter, startTelemetry } from './telemetry.js'

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  trace.disable()
  context.disable()
  propagation.disable()
  await Promise.all(
    directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  )
})

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'vela-trace-test-'))
  directories.push(path)

  return path
}

async function span(name = 'alpaca.request'): Promise<ReadableSpan> {
  const memory = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(memory)] })
  const value = provider.getTracer('test').startSpan(name)
  value.setAttribute('alpaca.operation', 'rightascension')
  value.end()
  await provider.forceFlush()
  const result = memory.getFinishedSpans()[0]!
  await provider.shutdown()

  return result
}

const exportSpans = (exporter: SpanExporter, spans: ReadableSpan[]) =>
  new Promise<ExportResult>(resolve => exporter.export(spans, resolve))

const records = async (path: string) =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))

describe('local tracing', () => {
  it('keeps detached children correlated and exports them while their run is still open', async () => {
    const file = join(await directory(), 'trace.jsonl')
    const telemetry = startTelemetry(file)
    const tracer = trace.getTracer('alignment-test')
    let release!: () => void

    const gate = new Promise<void>(resolve => {
      release = resolve
    })

    let rootId = ''

    const running = tracer.startActiveSpan('alignment.run', async root => {
      rootId = root.spanContext().spanId
      await gate
      await tracer.startActiveSpan('alpaca.request', async child => {
        await Promise.resolve()
        child.setAttribute('run.id', 'detached-run')
        child.addEvent('headers.received')
        child.end()
      })

      return root
    })

    release()
    const root = await running

    try {
      // No explicit forceFlush: the one-second batch timer makes children live.
      await vi.waitFor(async () => expect(await records(file)).toHaveLength(1), {
        timeout: 2500,
        interval: 50,
      })
      const [child] = await records(file)
      expect(child).toMatchObject({
        name: 'alpaca.request',
        parentSpanId: rootId,
        attributes: { 'run.id': 'detached-run' },
      })
      expect(child.traceId).toBe(root.spanContext().traceId)
      expect(child.events[0].name).toBe('headers.received')
      expect(child.startTimeUnixNano).toMatch(/^\d+$/)
      root.end()
      await telemetry.shutdown()
      expect((await records(file)).map(record => record.name)).toEqual([
        'alpaca.request',
        'alignment.run',
      ])
    } finally {
      root.end()
      await telemetry.shutdown()
    }
  })

  it('rotates complete JSON lines and retains only the configured files', async () => {
    const dir = await directory()
    const file = join(dir, 'trace.jsonl')
    const exporter = createTraceFileExporter(file, { maxFileBytes: 1700, retainedFiles: 3 })

    for (let index = 0; index < 12; index++) {
      expect((await exportSpans(exporter, [await span(`request-${index}`)])).code).toBe(
        ExportResultCode.SUCCESS,
      )
    }

    await exporter.shutdown()
    expect((await readdir(dir)).sort()).toEqual(['trace.jsonl', 'trace.jsonl.1', 'trace.jsonl.2'])

    for (const name of await readdir(dir)) {
      expect((await readFile(join(dir, name))).byteLength).toBeLessThanOrEqual(1700)
      expect((await records(join(dir, name))).every(record => record.type === 'span')).toBe(true)
    }

    expect((await records(file)).at(-1).name).toBe('request-11')
  })

  it('bounds pending exports without making the accepted write fail', async () => {
    const file = join(await directory(), 'trace.jsonl')
    const onError = vi.fn()
    const exporter = createTraceFileExporter(file, { maxPendingBytes: 2000, onError })
    const value = await span()
    // Enqueue in the same turn, before any filesystem operation can complete.
    const attempts = Array.from({ length: 12 }, () => exportSpans(exporter, [value]))
    const results = await Promise.all(attempts)
    expect(results.some(result => result.code === ExportResultCode.SUCCESS)).toBe(true)
    expect(results.some(result => result.code === ExportResultCode.FAILED)).toBe(true)
    expect(onError).toHaveBeenCalledTimes(1)
    await exporter.shutdown()
    expect((await records(file)).length).toBe(
      results.filter(result => result.code === ExportResultCode.SUCCESS).length,
    )
  })

  it('reports filesystem failure once and isolates it from callers and shutdown', async () => {
    const parent = join(await directory(), 'not-a-directory')
    await writeFile(parent, 'occupied')
    const onError = vi.fn()
    const exporter = createTraceFileExporter(join(parent, 'trace.jsonl'), { onError })
    const value = await span()
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.FAILED)
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.FAILED)
    expect(onError).toHaveBeenCalledTimes(1)
    await expect(exporter.shutdown()).resolves.toBeUndefined()
  })

  it('drains accepted writes at shutdown and rejects new exports', async () => {
    const file = join(await directory(), 'trace.jsonl')
    const exporter = createTraceFileExporter(file, { onError: () => {} })
    const value = await span()
    const accepted = exportSpans(exporter, [value])
    await exporter.shutdown()
    expect((await accepted).code).toBe(ExportResultCode.SUCCESS)
    expect(await records(file)).toHaveLength(1)
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.FAILED)
  })

  it('leaves tracing disabled when no path is configured', async () => {
    const telemetry = startTelemetry(undefined)
    expect(trace.getTracer('disabled').startSpan('request').isRecording()).toBe(false)
    await telemetry.forceFlush()
    await telemetry.shutdown()
  })
})

describe('recovering from write failures', () => {
  function fakeDisk() {
    const disk = { failing: false, partial: false, attempts: 0 }

    const append: typeof appendFile = async (path, data, options) => {
      disk.attempts++

      if (disk.failing) {
        if (disk.partial) await appendFile(path, String(data).slice(0, 40), options)
        throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
      }

      await appendFile(path, data, options)
    }

    return { disk, append }
  }

  function clock() {
    const time = { now: 1_000_000 }

    return { time, now: () => time.now }
  }

  async function setup() {
    const file = join(await directory(), 'trace.jsonl')
    const { disk, append } = fakeDisk()
    const { time, now } = clock()
    const onError = vi.fn()
    const exporter = createTraceFileExporter(file, { appendFile: append, now, onError })

    return { file, disk, time, onError, exporter, value: await span() }
  }

  it('drops the span of a failed write, counts it, and resumes after the pause', async () => {
    const { file, disk, time, onError, exporter, value } = await setup()
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.SUCCESS)

    disk.failing = true
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.FAILED)
    expect(exporter.health()).toMatchObject({
      state: 'failing',
      dropped: 1,
      lastError: { at: time.now, message: expect.stringContaining('ENOSPC') },
    })

    disk.failing = false
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.FAILED)
    expect(exporter.health()).toMatchObject({ state: 'failing', dropped: 2 })

    time.now += 5_000
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.SUCCESS)
    expect(exporter.health()).toMatchObject({ state: 'ok', dropped: 2, lastWriteAt: time.now })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(await records(file)).toHaveLength(2)
  })

  it('backs off 5, 30 then 60 seconds and keeps no queue of failed spans', async () => {
    const { disk, time, exporter, value } = await setup()
    disk.failing = true
    await exportSpans(exporter, [value])
    expect(disk.attempts).toBe(1)

    const retry = async (wait: number) => {
      const before = disk.attempts
      time.now += wait - 1
      await exportSpans(exporter, [value])
      expect(disk.attempts).toBe(before)
      time.now += 1
      await exportSpans(exporter, [value])
      expect(disk.attempts).toBe(before + 1)
    }

    await retry(5_000)
    await retry(30_000)
    await retry(60_000)
    await retry(60_000)

    const attempts = disk.attempts
    const skipped = await Promise.all(Array.from({ length: 500 }, () => exportSpans(exporter, [value, value])))
    expect(skipped.every(result => result.code === ExportResultCode.FAILED)).toBe(true)
    expect(disk.attempts).toBe(attempts)
    expect(exporter.health()).toMatchObject({ state: 'failing', dropped: 9 + 1000 })
    await expect(exporter.shutdown()).resolves.toBeUndefined()
  })

  it('discards the torn line a full disk leaves so later spans stay readable', async () => {
    const { file, disk, time, exporter, value } = await setup()
    await exportSpans(exporter, [await span('before')])
    disk.failing = true
    disk.partial = true
    await exportSpans(exporter, [value])
    disk.failing = false
    time.now += 5_000
    await exportSpans(exporter, [await span('after')])
    expect((await records(file)).map(record => record.name)).toEqual(['before', 'after'])
  })

  it('retries an unwritable traces directory and starts writing once it appears', async () => {
    const parent = join(await directory(), 'traces')
    await writeFile(parent, 'occupied')
    const { time, now } = clock()
    const exporter = createTraceFileExporter(join(parent, 'trace.jsonl'), { now, onError: () => {} })
    const value = await span()
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.FAILED)
    expect(exporter.health().state).toBe('failing')

    await rm(parent)
    time.now += 5_000
    expect((await exportSpans(exporter, [value])).code).toBe(ExportResultCode.SUCCESS)
    expect(exporter.health()).toMatchObject({ state: 'ok', dropped: 1 })
    expect(await records(join(parent, 'trace.jsonl'))).toHaveLength(1)
  })

  it('shows failing then ok on /api/health', async () => {
    const { disk, time, exporter, value } = await setup()
    const app = buildApp({ telemetry: { health: () => exporter.health() } })
    const health = async () => (await app.inject('/api/health')).json().telemetry

    expect(await health()).toMatchObject({ state: 'ok', dropped: 0, lastError: null })
    disk.failing = true
    await exportSpans(exporter, [value])
    expect(await health()).toMatchObject({ state: 'failing', dropped: 1, lastError: { message: expect.stringContaining('ENOSPC') } })
    disk.failing = false
    time.now += 5_000
    await exportSpans(exporter, [value])
    expect(await health()).toMatchObject({ state: 'ok', dropped: 1 })
    await app.close()
  })
})
