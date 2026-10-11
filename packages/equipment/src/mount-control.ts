/** Fresh mount facts; omitted values are unknown, never false. */
export interface MountControlObservation {
  readonly parked?: boolean
  readonly tracking?: boolean
  readonly slewing?: boolean
  readonly canUnpark?: boolean
  readonly canSetTracking?: boolean
  readonly observedAt?: string
}

export type MountControlCommand = {
  readonly telescopeId: string
  readonly expectedTelescopeName?: string
  readonly signal?: AbortSignal
} & (
  | { readonly kind: 'unpark' }
  | { readonly kind: 'set-tracking'; readonly tracking: boolean }
)

export type MountControlCommandResult =
  | { readonly outcome: 'confirmed'; readonly observation: MountControlObservation }
  | {
      readonly outcome: 'failed'
      readonly reason: 'device-not-found' | 'disconnected' | 'unsupported' | 'busy' |
        'parked' | 'unavailable' | 'rejected' | 'not-confirmed'
      readonly message?: string
    }
  | {
      readonly outcome: 'uncertain'
      readonly reason: 'cancelled' | 'write-outcome-unknown' | 'verification-unavailable'
      readonly message?: string
    }

/** Each command is explicit, issued at most once, and confirmed by fresh readback. */
export interface MountControl {
  observe(telescopeId: string, signal?: AbortSignal): Promise<MountControlObservation | undefined>
  execute(command: MountControlCommand): Promise<MountControlCommandResult>
}
