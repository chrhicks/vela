import { setTimeout as delay } from 'node:timers/promises'
import { EquipmentError } from '@vela/equipment'
import { CriaHttp } from './http.js'
import { CriaStateSchema, type CriaState } from './schema.js'

export interface ObservedState {
  state: CriaState
  receivedAt: number
  /** Conservative transport-delay bound, including the complete initial request RTT. */
  roundTripMs: number
  receivedMonotonic: number
  connectionId?: number
}

interface EventTiming {
  eventIdleTimeoutMs: number
  eventReconnectMs: number
  eventMaxReconnectMs: number
  maxStateRoundTripMs: number
}

const eventBytesLimit = 4 * 1024 * 1024

function interruption(message = 'Cria state stream is interrupted'): EquipmentError {
  return new EquipmentError(message, { reason: 'transport', endpoint: '/v2/events' })
}

/** One latest snapshot, with no replay queue: Cria's state events are complete and lossy. */
export class CriaEvents {
  private readonly lifetime = new AbortController()
  private readonly listeners = new Set<() => void>()
  private latest: ObservedState | null = null
  private error: EquipmentError | null = null
  private revision = 0
  private connectionId = 0
  private readonly completion: Promise<void>

  constructor(
    private readonly http: CriaHttp,
    private readonly timing: EventTiming,
    private readonly accept: (state: CriaState) => void,
  ) {
    this.completion = this.connect()
  }

  get version(): number { return this.revision }

  get current(): ObservedState | null {
    return this.error === null ? this.latest : null
  }

  owns(snapshot: ObservedState): boolean {
    return this.current !== null && snapshot.connectionId === this.connectionId
  }

  private changed(): void {
    this.revision++

    for (const listener of this.listeners) listener()
  }

  async state(signal?: AbortSignal): Promise<ObservedState> {
    signal?.throwIfAborted()

    if (this.error !== null) throw this.error

    if (!this.latest) await this.wait(this.revision, this.timing.eventIdleTimeoutMs, signal)

    if (this.error !== null) throw this.error

    if (!this.latest) throw interruption('Cria state stream has not supplied a snapshot')

    return this.latest
  }

  /** Waiters observe a version, never retain a queue of snapshots. */
  async wait(version: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()

    if (version !== this.revision) return
    let finish = () => {}

    let abort = () => {}

    let timer: ReturnType<typeof setTimeout> | undefined

    const change = new Promise<void>((resolve, reject) => {
      finish = resolve
      abort = () => reject(signal?.reason)
      this.listeners.add(finish)
      signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(resolve, Math.max(1, timeoutMs))
    })

    try {
      await change
    } finally {
      clearTimeout(timer)
      this.listeners.delete(finish)
      signal?.removeEventListener('abort', abort)
    }
  }

  async close(): Promise<void> {
    this.error = interruption('Cria client is closed')
    this.lifetime.abort()
    this.changed()
    await this.completion
  }

  private async connect(): Promise<void> {
    let retryMs = this.timing.eventReconnectMs

    while (!this.lifetime.signal.aborted) {
      const attempt = new AbortController()
      const signal = AbortSignal.any([attempt.signal, this.lifetime.signal])
      const started = performance.now()
      let timer: ReturnType<typeof setTimeout> | undefined
      let anchor: ObservedState | null = null
      let previous: CriaState | null = null

      const received = () => {
        clearTimeout(timer)
        timer = setTimeout(() => attempt.abort(), this.timing.eventIdleTimeoutMs)
      }

      this.connectionId++
      received()

      try {
        await this.http.events(signal, body => this.read(body, signal, value => {
          const state = CriaStateSchema.parse(JSON.parse(value))
          const now = performance.now()

          const lastState = previous ?? this.latest?.state

          if (lastState?.instanceId === state.instanceId && state.sequence < lastState.sequence ||
            previous?.instanceId === state.instanceId && state.generatedAt < previous.generatedAt)
            throw interruption('Cria state stream moved backwards')

          if (previous?.instanceId === state.instanceId && state.sequence === previous.sequence) return

          // Initial State() is constructed after the subscription request. Its entire RTT
          // bounds initial delay. Thereafter compare elapsed time on each clock, never
          // their absolute values, so buffered frames cannot become fresh on receipt.
          const transportMs = anchor === null
            ? now - started
            : anchor.state.generatedAt + anchor.roundTripMs + now - anchor.receivedMonotonic - state.generatedAt

          if (transportMs > this.timing.maxStateRoundTripMs ||
            transportMs < -this.timing.maxStateRoundTripMs)
            throw interruption('Cria state stream timing cannot establish fresh observations')

          this.accept(state)

          const snapshot: ObservedState = {
            state,
            receivedAt: Date.now(),
            roundTripMs: Math.max(0, transportMs),
            receivedMonotonic: now,
            connectionId: this.connectionId,
          }

          anchor ??= snapshot
          previous = state
          this.latest = snapshot
          this.error = null
          retryMs = this.timing.eventReconnectMs
          received()
          this.changed()
        }, received))

        throw interruption()
      } catch (error) {
        this.error = error instanceof EquipmentError ? error : interruption()
        this.changed()
      } finally {
        clearTimeout(timer)
        attempt.abort()
      }

      if (this.lifetime.signal.aborted) break

      try {
        await delay(retryMs, undefined, { signal: this.lifetime.signal })
      } catch {
        break
      }

      retryMs = Math.min(this.timing.eventMaxReconnectMs, retryMs * 2)
    }
  }

  private async read(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    onState: (value: string) => void,
    onActivity: () => void,
  ): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    let event = ''
    let data: string[] = []
    let eventBytes = 0
    const abort = () => { void reader.cancel().catch(() => {}) }

    signal.addEventListener('abort', abort, { once: true })

    try {
      for (;;) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()

        if (done) return

        if (value.byteLength > eventBytesLimit)
          throw interruption('Cria state stream chunk exceeds its size bound')
        pending += decoder.decode(value, { stream: true })
        let newline = pending.indexOf('\n')

        while (newline !== -1) {
          const line = pending.slice(0, newline).replace(/\r$/, '')

          pending = pending.slice(newline + 1)
          eventBytes += Buffer.byteLength(line) + 1

          if (eventBytes > eventBytesLimit) throw interruption('Cria state event exceeds its size bound')

          if (line === '') {
            if (event === 'state' && data.length > 0) onState(data.join('\n'))
            onActivity()
            event = ''
            data = []
            eventBytes = 0
          } else if (line.startsWith('event:')) {
            event = line.slice(6).replace(/^ /, '')
          } else if (line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''))
          }

          newline = pending.indexOf('\n')
        }

        if (eventBytes + Buffer.byteLength(pending) > eventBytesLimit)
          throw interruption('Cria state event exceeds its size bound')
      }
    } finally {
      signal.removeEventListener('abort', abort)
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}
