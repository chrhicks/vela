import type { Reading } from '../../components/Readings.tsx'

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




export interface RigReady {
  readonly at: string
  readonly summary: ReadonlyArray<Reading>
}

export const rigReady: RigReady = {
  at: '18:42',
  summary: [
    { label: 'Checklist', value: '8 OF 8' },
    { label: 'Devices', value: '7 OF 7' },
    { label: 'Align', value: '0.8′' },
    { label: 'Focus', value: '2.8 px' },
  ],
}
