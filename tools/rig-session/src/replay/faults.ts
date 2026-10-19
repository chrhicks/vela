/**
 * A fault `indi-replay` injects, spelled as its `--faults` file spells it (Cria's
 * `packages/indi-replay/src/faults.ts`). It starts when the replay reserves (`before-exposure`, the
 * default) or delivers (`before-blob`) source frame `at`, counted from 0; how long it lasts is real time.
 */
export type ReplayFault = { at: number; phase?: 'before-exposure' | 'before-blob' } & (
  /** Frames `at` to `at + count - 1` arrive with every pixel equal. */
  | { kind: 'blank'; count: number }
  /** A device property takes these values and keeps them. */
  | { kind: 'set'; device: string; property: string; values: Record<string, number | boolean | string>; state?: 'Idle' | 'Ok' | 'Busy' | 'Alert' }
  /** The driver for `device` sends nothing and answers no getProperties for `forMs`. */
  | { kind: 'silent'; device: string; forMs: number }
  /** Every connection is closed, and new ones are refused for `forMs`. */
  | { kind: 'disconnect'; forMs?: number }
)
