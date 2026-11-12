import { Effect } from 'effect'

export const runHandledSync = <A>(effect: Effect.Effect<A, never>): A => Effect.runSync(effect)

export const runHandledPromise = <A>(effect: Effect.Effect<A, never>): Promise<A> => Effect.runPromise(effect)
