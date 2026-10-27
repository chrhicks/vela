export type SwitchSetCommand = {
  readonly switchId: string
  readonly expectedSwitchName?: string
  readonly channelId: number
  readonly value: number
  readonly signal?: AbortSignal
}

/** `confirmed.value` is what the device reports holding, which can differ from the request (a quantized duty). */
export type SwitchSetResult =
  | { readonly outcome: 'confirmed'; readonly value?: number }
  | { readonly outcome: 'failed'; readonly reason: 'device-not-found' | 'rejected'; readonly message?: string }
  | {
      readonly outcome: 'uncertain'
      readonly reason: 'cancelled' | 'write-outcome-unknown'
      readonly message?: string
    }

/** One channel write, issued at most once. The device decides whether the value is allowed. */
export interface SwitchControl {
  set(command: SwitchSetCommand): Promise<SwitchSetResult>
}
