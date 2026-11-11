import type { Band, ChartProps } from '../../components/Chart.tsx'
import type { LogLine } from '../../components/Log.tsx'
import type { Reading } from '../../components/Readings.tsx'
import { drift } from '../../stub/series.ts'

export interface Trend {
  readonly chart: Omit<ChartProps, 'xLabels'>
  readonly onPhone: boolean
}

export interface AlertFix {
  readonly label: string
  readonly to?: string
}

export interface RunAlert {
  readonly title: string
  readonly facts: ReadonlyArray<string>
  readonly fixes: ReadonlyArray<AlertFix>
}

export interface Capturing {
  readonly frame: number
  readonly facts: ReadonlyArray<string>
  readonly alert: RunAlert | undefined
  readonly rig: ReadonlyArray<Reading>
  readonly latest: { readonly detail: string; readonly stats: ReadonlyArray<Reading> }
  readonly stack: { readonly detail: string; readonly counts: ReadonlyArray<Reading> }
  readonly handled: ReadonlyArray<LogLine>
  readonly trends: ReadonlyArray<Trend>
  readonly span: readonly [string, string]
}

const hfdBand: Band = { from: 2.8, to: 3.15 }
const starsBand: Band = { from: 850, to: 1100 }
const guidingBand: Band = { from: -1.5, to: 1.5 }

const steadyTrends: ReadonlyArray<Trend> = [
  {
    onPhone: true,
    chart: {
      title: 'HFD px',
      current: '2.84',
      lines: [drift({ seed: 11, count: 60, from: 3.3, to: 2.9, noise: 0.12 })],
      yTicks: [2.8, 3.2, 3.6],
      band: hfdBand,
    },
  },
  {
    onPhone: true,
    chart: {
      title: 'Stars',
      current: '975',
      lines: [drift({ seed: 23, count: 60, from: 760, to: 1000, noise: 70 })],
      yTicks: [500, 800, 1100],
      band: starsBand,
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Guiding ″ RA / Dec',
      current: '3.4 / 0.5',
      lines: [
        drift({ seed: 37, count: 60, from: 0, to: 0, noise: 3.2 }),
        drift({ seed: 41, count: 60, from: 0, to: 0, noise: 0.8 }),
      ],
      yTicks: [-5, 0, 5],
      band: guidingBand,
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Temp °C air / focuser',
      current: '9.1 / 11',
      lines: [
        drift({ seed: 53, count: 60, from: 12.5, to: 9.1, noise: 0.15 }),
        drift({ seed: 59, count: 60, from: 13.6, to: 11, noise: 0.15 }),
      ],
      yTicks: [6, 11, 16],
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Dew heater %',
      current: '60',
      lines: [drift({ seed: 67, count: 60, from: 42, to: 60, noise: 1.5 })],
      yTicks: [0, 50, 100],
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Humidity %',
      current: '74',
      lines: [drift({ seed: 71, count: 60, from: 62, to: 74, noise: 1 })],
      yTicks: [0, 50, 100],
    },
  },
]

const lostTrends: ReadonlyArray<Trend> = [
  {
    onPhone: true,
    chart: {
      title: 'HFD px',
      current: '4.9',
      lines: [
        [
          ...drift({ seed: 11, count: 44, from: 3.3, to: 2.9, noise: 0.12 }),
          ...drift({ seed: 13, count: 14, from: 3.6, to: 4.9, noise: 0.15 }).map(point => ({ x: point.x + 44, y: point.y })),
        ],
      ],
      yTicks: [2.8, 3.9, 5],
      band: hfdBand,
    },
  },
  {
    onPhone: true,
    chart: {
      title: 'Stars',
      current: '120',
      lines: [
        [
          ...drift({ seed: 23, count: 44, from: 800, to: 1050, noise: 60 }),
          ...drift({ seed: 29, count: 14, from: 420, to: 110, noise: 25 }).map(point => ({ x: point.x + 44, y: point.y })),
        ],
      ],
      yTicks: [0, 550, 1100],
      band: starsBand,
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Guiding ″ RA / Dec',
      current: 'LOST',
      lines: [
        [
          ...drift({ seed: 37, count: 44, from: 0, to: 0, noise: 3.2 }),
          { x: 44, y: 0 },
          { x: 57, y: 0 },
        ],
      ],
      yTicks: [-5, 0, 5],
      band: guidingBand,
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Temp °C air / focuser',
      current: '8.7 / 10.6',
      lines: [
        drift({ seed: 53, count: 58, from: 12.5, to: 8.7, noise: 0.15 }),
        drift({ seed: 59, count: 58, from: 13.6, to: 10.6, noise: 0.15 }),
      ],
      yTicks: [6, 11, 16],
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Dew heater %',
      current: '100',
      lines: [drift({ seed: 67, count: 58, from: 42, to: 100, noise: 1.5 })],
      yTicks: [0, 50, 100],
    },
  },
  {
    onPhone: false,
    chart: {
      title: 'Humidity %',
      current: '97',
      lines: [drift({ seed: 71, count: 58, from: 70, to: 97, noise: 1 })],
      yTicks: [0, 50, 100],
    },
  },
]

export const capturing: Readonly<Record<'steady' | 'alert', Capturing>> = {
  steady: {
    frame: 42,
    facts: ['NGC 7635', '60 s', 'Since 20:52', 'Until stopped', 'Filter out'],
    alert: undefined,
    rig: [
      { label: 'Mount', value: 'Tracking' },
      { label: 'Guiding', value: 'On 3.5″' },
      { label: 'Sensor', value: '-10.0 °C' },
      { label: 'Focus', value: '32332' },
      { label: 'Dew', value: '60 %' },
      { label: 'Flip', value: 'In 2 h 10' },
    ],
    latest: {
      detail: '42 · 21:33:09',
      stats: [
        { label: 'HFD', value: '2.84 px' },
        { label: 'Stars', value: '975' },
        { label: 'Sky', value: '909' },
        { label: 'Noise', value: '43.0' },
        { label: 'Off centre', value: '14″' },
        { label: 'Vs baseline', value: 'OK' },
      ],
    },
    stack: {
      detail: '42 frames · 42 min',
      counts: [
        { label: 'Frames', value: '42' },
        { label: 'Poor', value: '0' },
      ],
    },
    handled: [
      { at: '21:14', text: 'Guide star lost, recovered' },
      { at: '20:58', text: 'Refocus 32410 → 32332' },
      { at: '20:53', text: 'First frames OK' },
      { at: '20:49', text: 'Slew and centre done' },
    ],
    trends: steadyTrends,
    span: ['20:53', '21:52'],
  },
  alert: {
    frame: 57,
    facts: ['NGC 7635', '60 s', 'Since 20:52', 'Until stopped', 'Filter in'],
    alert: {
      title: 'Guide star lost 21:36',
      facts: ['Cause: guide cam sees 0 stars', 'Tried: restart x3', 'Frames still arriving'],
      fixes: [{ label: 'Pick new star' }, { label: 'Restart PHD2' }, { label: 'Open guiding controls', to: '/controls/guiding' }],
    },
    rig: [
      { label: 'Mount', value: 'Tracking' },
      { label: 'Guiding', value: 'Lost', attention: true },
      { label: 'Sensor', value: '-10.0 °C' },
      { label: 'Focus', value: '32332' },
      { label: 'Dew', value: '100 %' },
      { label: 'Flip', value: 'In 1 h 52' },
    ],
    latest: {
      detail: '57 · 21:50:12',
      stats: [
        { label: 'HFD', value: '4.9 px' },
        { label: 'Stars', value: '120' },
        { label: 'Vs baseline', value: 'POOR', attention: true },
      ],
    },
    stack: {
      detail: '44 frames · 44 min',
      counts: [
        { label: 'Frames', value: '57' },
        { label: 'Poor', value: '13', attention: true },
      ],
    },
    handled: [],
    trends: lostTrends,
    span: ['20:53', '21:50'],
  },
}

export interface Check {
  readonly label: string
  readonly value: string
  readonly verdict: string
}

export interface Starting {
  readonly facts: ReadonlyArray<string>
  readonly latestDetail: string
  readonly sequence: ReadonlyArray<Reading>
  readonly checks: ReadonlyArray<Check>
  readonly baseline: string
}

export const starting: Starting = {
  facts: ['NGC 7635', '60 s', 'Frame 5', 'First frames OK 20:57'],
  latestDetail: '5 · 20:57:47',
  sequence: [
    { label: 'Home', value: 'DONE' },
    { label: 'Slew and centre', value: 'DONE' },
    { label: 'Autofocus', value: 'DONE' },
    { label: 'Guiding', value: 'DONE' },
    { label: 'Frames 1 to 2', value: 'SKIPPED, SETTLING' },
    { label: 'Frames 3 to 5', value: 'CHECKED' },
  ],
  checks: [
    { label: 'On target', value: '14″', verdict: 'OK' },
    { label: 'Stars', value: '782', verdict: 'OK' },
    { label: 'HFD vs focus', value: '3.1 / 2.8', verdict: 'OK' },
    { label: 'Trailing', value: 'NONE', verdict: 'OK' },
    { label: 'Sky', value: '936', verdict: 'OK' },
    { label: 'Filter', value: 'IN', verdict: 'OK' },
    { label: 'Settings', value: 'AS SET', verdict: 'OK' },
    { label: 'Guiding', value: '3.5″', verdict: 'OK' },
  ],
  baseline: 'Baseline set from frames 3 to 5',
}

export const startingSeconds = 8

export interface NightOver {
  readonly facts: ReadonlyArray<string>
  readonly rig: ReadonlyArray<Reading>
  readonly totals: ReadonlyArray<Reading>
  readonly handled: ReadonlyArray<LogLine>
  readonly stackDetail: string
  readonly trends: ReadonlyArray<Trend>
  readonly span: readonly [string, string]
}

export const nightOver: NightOver = {
  facts: ['NGC 7635', '60 s', '20:52 to 05:41', 'Stopped at dawn'],
  rig: [
    { label: 'Guiding', value: 'Stopped' },
    { label: 'Cooler', value: 'Off' },
    { label: 'Mount', value: 'Homed' },
    { label: 'Rig PC', value: 'Up' },
  ],
  totals: [
    { label: 'Frames', value: '512' },
    { label: 'Poor', value: '37' },
    { label: 'Exposure', value: '8 H 32 MIN' },
    { label: 'Flips', value: '1' },
    { label: 'Refocuses', value: '3' },
    { label: 'Alerts', value: '1' },
  ],
  handled: [
    { at: '05:41', text: 'Dawn, run stopped, homed' },
    { at: '01:18', text: 'Refocus 32332 → 32290' },
    { at: '23:46', text: 'Flip done' },
    { at: '22:31', text: 'Guide star lost, recovered' },
  ],
  stackDetail: '475 frames',
  trends: [
    {
      onPhone: false,
      chart: {
        title: 'HFD px',
        current: '2.9',
        lines: [drift({ seed: 83, count: 180, from: 3.25, to: 2.95, noise: 0.1 })],
        yTicks: [2.8, 3.2, 3.6],
        band: hfdBand,
      },
    },
    {
      onPhone: false,
      chart: {
        title: 'Stars',
        current: '940',
        lines: [
          [
            ...drift({ seed: 89, count: 110, from: 880, to: 980, noise: 50 }),
            ...drift({ seed: 97, count: 22, from: 260, to: 280, noise: 20 }).map(point => ({ x: point.x + 110, y: point.y })),
            ...drift({ seed: 101, count: 48, from: 1000, to: 960, noise: 50 }).map(point => ({ x: point.x + 132, y: point.y })),
          ],
        ],
        yTicks: [0, 550, 1100],
        band: starsBand,
      },
    },
    {
      onPhone: false,
      chart: {
        title: 'Temp °C air / focuser',
        current: '4.2 / 6',
        lines: [
          drift({ seed: 103, count: 180, from: 12.5, to: 4.2, noise: 0.15 }),
          drift({ seed: 107, count: 180, from: 13.6, to: 6, noise: 0.15 }),
        ],
        yTicks: [0, 8, 16],
      },
    },
  ],
  span: ['20:52', '05:41'],
}
