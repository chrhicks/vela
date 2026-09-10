import { expect, it } from 'vitest'
import { trace, context } from '@opentelemetry/api'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import type { AlpacaAcquisition } from '@vela/alpaca'
import { createAlignmentController } from './controller.js'

it('exports correlated steps while a detached alignment is active and records cancellation', async () => {
  const exporter = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  provider.register()
  let capturing!: () => void
  const pending = new Promise<void>(resolve => { capturing = resolve })
  const hardware: AlpacaAcquisition = {
    pointing: async () => ({ rightAscensionDegrees: 12, declinationDegrees: 60, siderealTimeDegrees: 0,
      latitudeDegrees: 40, tracking: true, coordinateSystem: 'j2000' }),
    capture: async ({ signal }) => new Promise((_resolve, reject) => {
      capturing()
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
    }),
    move: async () => {}, rotateRightAscension: async () => {}, abort: async () => {},
  }
  const alignment = createAlignmentController({ endpoint: 'http://simulator', cameraId: 'camera', telescopeId: 'mount',
    executable: '/unused', catalogPath: '/unused', exposureSeconds: 1, fieldHeightDegrees: 3 }, hardware,
    { solve: async () => { throw new Error('Capture is still pending') } })
  try {
    await trace.getTracer('test').startActiveSpan('command', async span => {
      await alignment.start('rig', 'Rig')
      span.end()
    })
    await pending
    expect(alignment.active()).toBe(true)
    expect(exporter.getFinishedSpans().map(span => span.name)).toContain('alignment.started')
    expect(exporter.getFinishedSpans().map(span => span.name)).not.toContain('alignment.run')
    await alignment.stop()
    const spans = exporter.getFinishedSpans()
    const command = spans.find(span => span.name === 'command')!
    const run = spans.find(span => span.name === 'alignment.run')!
    const capture = spans.find(span => span.name === 'alignment.capture')!
    expect(run.parentSpanContext?.spanId).toBe(command.spanContext().spanId)
    expect(capture.parentSpanContext?.spanId).toBe(run.spanContext().spanId)
    expect(capture.spanContext().traceId).toBe(command.spanContext().traceId)
    expect(capture.attributes['alignment.run.id']).toBe(run.attributes['alignment.run.id'])
    expect(capture.attributes['rig.id']).toBe('rig')
    expect(capture.attributes['operation.cancelled']).toBe(true)
    expect(run.attributes['operation.cancelled']).toBe(true)
  } finally {
    await alignment.stop()
    await provider.shutdown()
    trace.disable()
    context.disable()
  }
})
