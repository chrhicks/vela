/** Explicit, server-owned mount commands; never an automatic preparation sequence. */
export type MountControlAction = 'unpark' | 'tracking-on' | 'tracking-off'

export interface MountControlAvailability {
  readonly enabled: boolean
  readonly reason: string | null
}

export interface MountControlView {
  readonly serverInstanceId: string
  readonly unpark: MountControlAvailability
  readonly trackingOn: MountControlAvailability
  readonly trackingOff: MountControlAvailability
  readonly command: {
    readonly requestId: string
    readonly action: MountControlAction
    readonly state: 'pending' | 'confirmed' | 'failed' | 'uncertain'
    readonly message: string | null
  } | null
}
