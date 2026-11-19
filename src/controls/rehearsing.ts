import { Context, Effect, Fiber } from 'effect'
import type { RehearsalEnding } from '../../state/entries.ts'

export type Cancelled = Extract<RehearsalEnding, 'stopped' | 'pressed'>

export class RehearsalRunning extends Context.Service<
  RehearsalRunning,
  { readonly busy: Effect.Effect<boolean>; readonly began: (routine: Fiber.Fiber<void>) => Effect.Effect<void>; readonly cancelled: Effect.Effect<Cancelled> }
>()('vela/RehearsalRunning') {}
