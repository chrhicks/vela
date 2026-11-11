import type { Reading } from '../../components/Readings.tsx'

export const areaIds = ['mount', 'guiding', 'focus', 'camera', 'dew', 'calibration', 'system'] as const

export type AreaId = (typeof areaIds)[number]

interface AreaState {
  readonly heading: string
  readonly summary: string
  readonly readings: ReadonlyArray<Reading>
}

export const run = ['Run active', 'NGC 7635', 'Frame 42']

export const areas: Readonly<Record<AreaId, AreaState>> = {
  mount: {
    heading: 'Mount',
    summary: 'Tracking',
    readings: [
      { label: 'Tracking', value: 'ON' },
      { label: 'Pier side', value: 'WEST' },
      { label: 'RA', value: '23 20 48' },
      { label: 'Dec', value: '+61 12' },
      { label: 'Alt', value: '71°' },
      { label: 'To meridian', value: '2 H 10' },
    ],
  },
  guiding: {
    heading: 'Guiding',
    summary: 'On 3.5″',
    readings: [
      { label: 'PHD2', value: 'GUIDING' },
      { label: 'RMS', value: '3.5″' },
      { label: 'Star SNR', value: '42' },
    ],
  },
  focus: {
    heading: 'Focus',
    summary: '32332',
    readings: [
      { label: 'Position', value: '32332' },
      { label: 'Temp', value: '11 °C' },
      { label: 'HFD', value: '2.84 px' },
    ],
  },
  camera: {
    heading: 'Camera',
    summary: '-10.0 °C',
    readings: [
      { label: 'Sensor', value: '-10.0 °C' },
      { label: 'Cooler', value: 'ON 38 %' },
      { label: 'Gain', value: '100' },
      { label: 'Offset', value: '50' },
    ],
  },
  dew: {
    heading: 'Dew heater',
    summary: 'Auto 60 %',
    readings: [
      { label: 'Main scope', value: 'AUTO 60 %' },
      { label: 'Air', value: '9.1 °C 74 %' },
    ],
  },
  calibration: {
    heading: 'Calibration',
    summary: 'None tonight',
    readings: [{ label: 'Last set', value: 'NONE TONIGHT' }],
  },
  system: {
    heading: 'System',
    summary: '7 of 7 set',
    readings: [
      { label: 'Rig PC', value: 'UP 3 H 12' },
      { label: 'Rig program', value: 'RUNNING' },
      { label: 'Devices', value: '7 OF 7 SET' },
      { label: 'Align + focus frames', value: '31 GB' },
    ],
  },
}

export const defaults = {
  slewTarget: 'NGC 7635',
  focusPosition: '32332',
  testFrame: '2 s',
  coolerSetpoint: '-10 °C',
  dewLevel: '60 %',
  calibrationFrames: '30',
  resetDevice: 'Camera',
} as const

export type CalibrationType = 'darks' | 'flats' | 'dark-flats' | 'bias'

export const calibrationFirstStep: Readonly<Record<CalibrationType, string>> = {
  darks: 'Cap on first',
  flats: 'Cover the front first',
  'dark-flats': 'Cover on, then cap',
  bias: 'Cap on first',
}
