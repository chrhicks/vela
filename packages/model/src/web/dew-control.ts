import type { MountControlAvailability } from './mount-control.js'

/** The only switch writes Vela offers: the power box's Auto dew switch and its dew duty channels. */
export type DewControlAction =
  | { readonly kind: 'auto'; readonly on: boolean }
  | { readonly kind: 'duty'; readonly channelId: number; readonly percent: number }

export interface DewChannelView {
  readonly id: number
  readonly name: string
  /** What the box reports now, which can differ a little from what was set (it quantizes). */
  readonly dutyPercent: number | null
  /** Setting a fixed duty. Disabled with "Auto dew is on" while the box sets its own duty. */
  readonly set: MountControlAvailability
}

export interface DewControlView {
  readonly serverInstanceId: string
  /** Null when the box has no Auto dew channel. `on` is null when it does not report one. */
  readonly auto: {
    readonly on: boolean | null
    readonly set: MountControlAvailability
  } | null
  readonly channels: ReadonlyArray<DewChannelView>
  readonly command: {
    readonly requestId: string
    readonly action: DewControlAction
    readonly state: 'pending' | 'confirmed' | 'failed' | 'uncertain'
    readonly message: string | null
  } | null
}
