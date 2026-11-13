import type { Point } from '../../components/Chart.tsx'
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




export interface Autofocus {
  readonly sample: string
  readonly curve: ReadonlyArray<Point>
  readonly best: Point
  readonly ticks: ReadonlyArray<number>
  readonly span: readonly [string, string]
  readonly result: ReadonlyArray<Reading>
}

export const autofocus: Autofocus = {
  sample: 'Sample 9 of 10',
  curve: [
    { x: 0, y: 9.8 },
    { x: 50, y: 8.3 },
    { x: 100, y: 13.9 },
    { x: 150, y: 10.1 },
    { x: 200, y: 6.4 },
    { x: 250, y: 3.6 },
    { x: 280, y: 2.8 },
    { x: 330, y: 5.9 },
    { x: 400, y: 10.4 },
  ],
  best: { x: 280, y: 2.8 },
  ticks: [0, 7, 14],
  span: ['32610', '32210'],
  result: [
    { label: 'Best', value: '32332' },
    { label: 'HFD', value: '2.8 px' },
    { label: 'Stars', value: '693' },
    { label: 'Temp', value: '12 °C' },
  ],
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
