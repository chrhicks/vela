import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { context, propagation, trace } from '@opentelemetry/api'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-node'
import { createTraceFileExporter, startTelemetry } from './telemetry.js'

const directories: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  trace.disable()
  context.disable()
  propagation.disable()
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
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
const exportSpans = (exporter: SpanExporter, spans: ReadableSpan[]) => new Promise<ExportResult>(resolve => exporter.export(spans, resolve))
const records = async (path: string) => (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))

describe('local tracing', () => {
  it('keeps detached children correlated and exports them while their run is still open', async () => {
    const file = join(await directory(), 'trace.jsonl')
    const telemetry = startTelemetry(file)
    const tracer = trace.getTracer('alignment-test')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
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
      await vi.waitFor(async () => expect(await records(file)).toHaveLength(1), { timeout: 2500, interval: 50 })
      const [child] = await records(file)
      expect(child).toMatchObject({ name: 'alpaca.request', parentSpanId: rootId, attributes: { 'run.id': 'detached-run' } })
      expect(child.traceId).toBe(root.spanContext().traceId)
      expect(child.events[0].name).toBe('headers.received')
      expect(child.startTimeUnixNano).toMatch(/^\d+$/)
      root.end()
      await telemetry.shutdown()
      expect((await records(file)).map(record => record.name)).toEqual(['alpaca.request', 'alignment.run'])
    } finally { root.end(); await telemetry.shutdown() }
  })

  it('rotates complete JSON lines and retains only the configured files', async () => {
    const dir = await directory()
    const file = join(dir, 'trace.jsonl')
    const exporter = createTraceFileExporter(file, { maxFileBytes: 1700, retainedFiles: 3 })
    for (let index = 0; index < 12; index++) expect((await exportSpans(exporter, [await span(`request-${index}`)])).code).toBe(ExportResultCode.SUCCESS)
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
    expect((await records(file)).length).toBe(results.filter(result => result.code === ExportResultCode.SUCCESS).length)
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
