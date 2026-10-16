import { Effect, Exit, Scope } from 'effect'
import { settle, type Ending, type Outcome } from '@cria/primitives'
import { openSession, type Session } from './v5/session.js'

export interface CriaConnectionOptions {
  readonly origin: string
  readonly token?: string
  readonly fetch?: typeof globalThis.fetch
}

export function createCriaConnection(options: CriaConnectionOptions) {
  const scope = Scope.makeUnsafe()
  let current: Session | undefined

  function session() {
    current ??= Effect.runSync(Scope.provide(scope)(openSession({
      origin: options.origin,
      token: options.token,
      fetch: options.fetch ?? globalThis.fetch,
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
