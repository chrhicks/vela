import type { Point } from '../../components/Chart.tsx'
import type { Reading } from '../../components/Readings.tsx'

export const stepCount = 6

export const checklist: ReadonlyArray<string> = [
  'Pier knob tight',
  'Power in',
  'Ethernet in',
  'PC button pressed',
  'Cables clear',
  'Cap off',
  'Guide dew heater on',
  'Filter out',
]

export const rigPc: Reading = { label: 'Rig PC', value: 'BOOTING 0:42' }

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

const cameraChanges: ReadonlyArray<Change> = [
  { property: 'Gain', from: '200', to: '100' },
  { property: 'Offset', from: '1', to: '50' },
  { property: 'Cooler', from: 'OFF', to: '-10 °C' },
]

export const bringUp: Readonly<Record<'setting' | 'set', ReadonlyArray<Device>>> = {
  setting: [
    { name: 'Rig PC', state: 'up', changes: [] },
    { name: 'Mount', state: 'set', changes: [] },
    { name: 'Focuser', state: 'set', changes: [] },
    { name: 'Power box', state: 'set', changes: [] },
    { name: 'Camera', state: 'setting', changes: cameraChanges },
    { name: 'Guide cam', state: 'waiting', changes: [] },
    { name: 'PHD2', state: 'waiting', changes: [] },
  ],
  set: [
    { name: 'Rig PC', state: 'up', changes: [] },
    { name: 'Mount', state: 'set', changes: [] },
    { name: 'Focuser', state: 'set', changes: [] },
    { name: 'Power box', state: 'set', changes: [] },
    { name: 'Camera', state: 'set', changes: [] },
    { name: 'Guide cam', state: 'set', changes: [] },
    { name: 'PHD2', state: 'set', changes: [] },
  ],
}

export const bringUpSeconds = 5

interface AlignAlert {
  readonly title: string
  readonly facts: ReadonlyArray<string>
}

export interface Alignment {
  readonly facts: ReadonlyArray<string>
  readonly alert: AlignAlert | undefined
  readonly error: ReadonlyArray<Reading>
  readonly instruction: string
  readonly summary: ReadonlyArray<Reading>
  readonly totals: ReadonlyArray<Point>
  readonly lastFrame: string
  readonly action: { readonly label: string; readonly to: string }
}

const frames = (totals: ReadonlyArray<number>): ReadonlyArray<Point> => totals.map((y, index) => ({ x: index + 1, y }))

export const alignment: Readonly<Record<'adjusting' | 'moved' | 'good', Alignment>> = {
  adjusting: {
    facts: ['Frame 6', '4 s ago', 'Filter out'],
    alert: undefined,
    error: [
      { label: 'Alt', value: '8.4′' },
      { label: 'Az', value: '12.1′' },
    ],
    instruction: 'Turn az left',
    summary: [
      { label: 'Total', value: '14.7′' },
      { label: 'Trend', value: 'FALLING' },
    ],
    totals: frames([41, 39, 35, 29, 22, 14.7]),
    lastFrame: 'Frame 6',
    action: { label: 'Done', to: '/launch/filter' },
  },
  moved: {
    facts: ['Frame 7', '2 s ago', 'Filter out'],
    alert: { title: 'Error jumped +6.8′', facts: ['Something moved', 'Check pier knob'] },
    error: [
      { label: 'Alt', value: '13.9′' },
      { label: 'Az', value: '16.4′' },
    ],
    instruction: 'Turn az left',
    summary: [
      { label: 'Total', value: '21.5′' },
      { label: 'Trend', value: 'JUMPED', attention: true },
    ],
    totals: frames([41, 39, 35, 29, 22, 14.7, 21.5]),
    lastFrame: 'Frame 7',
    action: { label: 'Restart', to: '/launch/align' },
  },
  good: {
    facts: ['Frame 14', '3 s ago', 'Filter out'],
    alert: undefined,
    error: [
      { label: 'Alt', value: '0.5′' },
      { label: 'Az', value: '0.6′' },
    ],
    instruction: 'Good',
    summary: [
      { label: 'Total', value: '0.8′' },
      { label: 'Trend', value: 'FALLING' },
    ],
    totals: frames([41, 39, 35, 29, 22, 14.7, 11.2, 8.9, 6.1, 4.4, 2.9, 1.8, 1.2, 0.8]),
    lastFrame: 'Frame 14',
    action: { label: 'Done', to: '/launch/filter' },
  },
}

export const alignErrorTicks: ReadonlyArray<number> = [0, 22, 45]
export const alignGoodBand = { from: 0, to: 1 }

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

export const autofocusSeconds = 6

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
