import type { Band, ChartProps } from '../../components/Chart.tsx'
import type { LogLine } from '../../components/Log.tsx'
import type { Reading } from '../../components/Readings.tsx'
import type { Trend } from './capturing.ts'
import { drift } from '../../stub/series.ts'

const hfdBand: Band = { from: 2.8, to: 3.15 }
const starsBand: Band = { from: 850, to: 1100 }
const guidingBand: Band = { from: -1.5, to: 1.5 }

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
