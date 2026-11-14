import { Schema } from 'effect'

export const CalibrationSetKind = Schema.Literals(['darks', 'flats', 'dark-flats', 'bias'])

export type CalibrationSetKind = typeof CalibrationSetKind.Type

export const calibrationSetWords: Readonly<Record<CalibrationSetKind, string>> = { darks: 'Darks', flats: 'Flats', 'dark-flats': 'Dark flats', bias: 'Bias' }

export const calibrationFirstStep: Readonly<Record<CalibrationSetKind, string>> = {
  darks: 'Cap on first',
  flats: 'Cover the front first',
  'dark-flats': 'Cover on, then cap',
  bias: 'Cap on first',
}
