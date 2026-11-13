export const stepCount = 6

export type DeviceState = 'waiting' | 'setting' | 'set' | 'up'

export interface Change {
  readonly property: string
  readonly from: string
  readonly to: string
}

export interface Device {
  readonly name: string
  readonly state: DeviceState
  readonly changes: ReadonlyArray<Change>
}
