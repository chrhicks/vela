import type { Reading } from '../../components/Readings.tsx'

interface Area {
  readonly heading: string
  readonly rows: ReadonlyArray<Reading>
}

export const areas: ReadonlyArray<Area> = [
  {
    heading: 'Mount',
    rows: [
      { label: 'Tracking', value: 'OFF' },
      { label: 'Pier side', value: 'WEST' },
    ],
  },
  {
    heading: 'Guiding',
    rows: [{ label: 'PHD2', value: 'STOPPED' }],
  },
  {
    heading: 'Focus',
    rows: [
      { label: 'Position', value: '32332' },
      { label: 'Temp', value: '11 °C' },
    ],
  },
  {
    heading: 'Camera',
    rows: [
      { label: 'Sensor', value: '-10.0 °C' },
      { label: 'Cooler', value: 'ON 38 %' },
    ],
  },
  {
    heading: 'Dew heater',
    rows: [{ label: 'Main scope', value: 'AUTO 60 %' }],
  },
  {
    heading: 'Calibration',
    rows: [{ label: 'Last set', value: 'NONE TONIGHT' }],
  },
  {
    heading: 'System',
    rows: [
      { label: 'Rig PC', value: 'UP 3 H 12' },
      { label: 'Rig program', value: 'RUNNING' },
    ],
  },
]
