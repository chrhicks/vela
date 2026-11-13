interface ControlDefaults {
  readonly dewLevel: string
  readonly calibrationFrames: string
  readonly resetDevice: string
}

export const defaults: ControlDefaults = {
  dewLevel: '60 %',
  calibrationFrames: '30',
  resetDevice: 'Camera',
}

export type CalibrationType = 'darks' | 'flats' | 'dark-flats' | 'bias'

export const calibrationFirstStep: Readonly<Record<CalibrationType, string>> = {
  darks: 'Cap on first',
  flats: 'Cover the front first',
  'dark-flats': 'Cover on, then cap',
  bias: 'Cap on first',
}
