import { Context, Effect, Fiber } from 'effect'
import type { RehearsalEnding } from '../../state/entries.ts'

export type Cancelled = Extract<RehearsalEnding, 'stopped' | 'pressed'>

export type Routine = 'rehearsal' | 'sweep'

export class RehearsalRunning extends Context.Service<
  RehearsalRunning,
  {
    readonly busy: Effect.Effect<boolean>
    readonly which: Effect.Effect<Routine | undefined>
    readonly began: (routine: Fiber.Fiber<void>, which: Routine) => Effect.Effect<void>
    readonly cancelled: Effect.Effect<Cancelled>
  }
>()('vela/RehearsalRunning') {}
