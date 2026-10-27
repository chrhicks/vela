/** Fresh mount facts; omitted values are unknown, never false. */
export interface MountControlObservation {
  readonly parked?: boolean
  readonly tracking?: boolean
  readonly slewing?: boolean
  readonly canUnpark?: boolean
  readonly canSetTracking?: boolean
  readonly canFindHome?: boolean
  /** The mount reports no at-home state; this is when Vela last saw a home confirmed, forgotten by any later move. */
  readonly homeConfirmedAt?: string
  readonly observedAt?: string
}

export type MountControlCommand = {
  readonly telescopeId: string
  readonly expectedTelescopeName?: string
  readonly signal?: AbortSignal
} & (
  | { readonly kind: 'unpark' }
  | { readonly kind: 'set-tracking'; readonly tracking: boolean }
  | { readonly kind: 'home' }
  | { readonly kind: 'stop' }
)

export type MountControlCommandResult =
  | { readonly outcome: 'confirmed'; readonly observation: MountControlObservation }
  | {
      readonly outcome: 'failed'
      readonly reason: 'device-not-found' | 'disconnected' | 'unsupported' | 'busy' |
        'parked' | 'unavailable' | 'rejected' | 'not-confirmed' | 'stopped'
      readonly message?: string
    }
  | {
      readonly outcome: 'uncertain'
      readonly reason: 'cancelled' | 'write-outcome-unknown' | 'verification-unavailable'
      readonly message?: string
    }

/**
 * Each command is explicit, issued at most once, and confirmed by fresh readback. `stop` is the
 * exception that proves it: it only ever stops motion, so it runs without readings, while the mount
 * is busy or held, and is safe to send again.
 */
export interface MountControl {
  /** Whether `stop` reaches this mount. A stop needs no readings, so it cannot be derived from `observe`. */
  readonly canStop: boolean
  observe(telescopeId: string, signal?: AbortSignal): Promise<MountControlObservation | undefined>
  execute(command: MountControlCommand): Promise<MountControlCommandResult>
}
