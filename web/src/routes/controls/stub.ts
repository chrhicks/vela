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
