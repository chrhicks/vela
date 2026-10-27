/** Explicit, server-owned mount commands; never an automatic preparation sequence. */
export type MountControlAction = 'unpark' | 'tracking-on' | 'tracking-off' | 'home'

export interface MountControlAvailability {
  readonly enabled: boolean
  readonly reason: string | null
}

export interface MountControlView {
  readonly serverInstanceId: string
  readonly unpark: MountControlAvailability
  readonly trackingOn: MountControlAvailability
  readonly trackingOff: MountControlAvailability
  readonly home: MountControlAvailability
  /** Stop is a halt, not a command: it never waits for, and is never recorded in, `command`. */
  readonly stop: MountControlAvailability
  /** When the last home Vela ran or saw confirmed, until the next move or a Vela restart. The mount reports no at-home state. */
  readonly homeConfirmedAt: string | null
  readonly command: {
    readonly requestId: string
    readonly action: MountControlAction
    readonly state: 'pending' | 'confirmed' | 'failed' | 'uncertain'
    readonly message: string | null
  } | null
}
