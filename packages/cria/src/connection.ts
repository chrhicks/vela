import { Effect, Exit, Scope } from 'effect'
import { settle, type Ending, type Outcome } from '@cria/primitives'
import { noJournal, type Journal, type JournalSink } from './v5/journal.js'
import { openSession, type Session } from './v5/session.js'

export interface CriaConnectionOptions {
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
    current ??= Effect.runSync(Scope.provide(scope)(openSession({
      origin: options.origin,
      token: options.token,
      fetch: options.fetch ?? globalThis.fetch,
      journal: options.journal ? originated(options.origin, options.journal) : noJournal,
    })))

    return current
  }

  return {
    session,
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
