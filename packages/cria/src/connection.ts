import { Effect, Exit, Scope } from 'effect'
import type { AcceptedFix, MountEnvelope } from '@cria/wire'
import { settle, type Ending, type Outcome } from '@cria/primitives'
import { noJournal, type Journal, type JournalSink } from './v5/journal.js'
import { openSession, type Session } from './v5/session.js'

export interface CriaConnectionOptions {
  readonly envelopes?: () => Promise<ReadonlyArray<{ deviceId: string; envelope: MountEnvelope }>>
  readonly onFeedbackError?: (message: string) => void
  readonly origin: string
  readonly token?: string
  readonly fetch?: typeof globalThis.fetch
  /** Receives what the client decodes from this origin. It never receives the token. */
  readonly journal?: JournalSink
}

export function createCriaConnection(options: CriaConnectionOptions) {
  const scope = Scope.makeUnsafe()
  let current: Session | undefined

  function session() {
    if (current) return current
    current = Effect.runSync(Scope.provide(scope)(openSession({
      origin: options.origin,
      token: options.token,
      fetch: options.fetch ?? globalThis.fetch,
      journal: options.journal ? originated(options.origin, options.journal) : noJournal,
    })))

    const opened = current
    const sent = new Map<string, string>()

    const sync = Effect.gen(function* () {
      const received = yield* opened.received

      if (received.state !== 'live') {
        sent.clear()

        return
      }

      const envelopes = yield* Effect.tryPromise(() => options.envelopes?.() ?? Promise.resolve([]))

      for (const { deviceId, envelope } of envelopes) {
        const key = JSON.stringify([received.snapshot.instanceId, envelope])

        if (sent.get(deviceId) === key) continue
        const reply = yield* opened.envelope(deviceId, envelope)

        if (reply.kind === 'answered') sent.set(deviceId, key)
        else options.onFeedbackError?.(reply.message)
      }
    }).pipe(Effect.catch(error => Effect.sync(() => options.onFeedbackError?.(String(error)))))

    if (options.envelopes) Effect.runSync(Scope.provide(scope)(Effect.forkScoped(Effect.forever(sync.pipe(Effect.andThen(Effect.sleep('1 second')))))))

    return current
  }

  return {
    session,
    async sendFix(deviceId: string, fix: AcceptedFix) {
      const reply = await Effect.runPromise(session().fix(deviceId, fix))

      if (reply.kind !== 'answered') throw new Error(`Cria did not receive the accepted fix: ${reply.message}`)
    },
    start() { session() },
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

export type CriaConnection = ReturnType<typeof createCriaConnection>

export function outcomeOf<A>(work: Effect.Effect<A, Ending>, signal?: AbortSignal): Promise<Outcome<A>> {
  if (signal?.aborted) return Promise.resolve({ kind: 'stopped' })

  return Effect.runPromise(settle(work), signal ? { signal, uninterruptible: true } : { uninterruptible: true })
}

/**
 * Names the Cria each entry came from, and keeps a failing sink from reaching the client. A sink
 * that throws, or returns a promise that rejects, is dropped for good.
 */
function originated(origin: string, sink: JournalSink): Journal {
  let failed = false

  function drop() {
    failed = true
  }

  return {
    record(entry) {
      if (failed) return

      try {
        const returned: unknown = sink.record({ ...entry, origin })

        if (returned instanceof Promise) returned.catch(drop)
      } catch {
        drop()
      }
    },
  }
}
