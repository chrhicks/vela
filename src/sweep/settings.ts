import { Schema } from 'effect'
import { described } from '../config.ts'

const Positive = Schema.Number.check(Schema.isGreaterThan(0))

export const RehearsalSettings = Schema.Struct({
  columnDegrees: described('The azimuth, in degrees, between two neighbouring columns of the rehearsal', Positive, 15),
  rowDegrees: described('The altitude, in degrees, between two stops down a column of the rehearsal, before each stop is split into steps by the axis limit', Positive, 5),
})

export const SweepSettings = Schema.Struct({
  columnDegrees: described('The azimuth, in degrees, between two neighbouring columns of the sweep', Positive, 2.5),
  legDegrees: described('The most, in degrees, either mount axis (hour angle or declination) turns in one step of a move', Positive, 5),
  floorDegrees: described('The lowest altitude, in degrees, a column reaches', Schema.Number, 2),
  ceilingDegrees: described('The highest altitude, in degrees, a column reaches', Schema.Number, 70),
  rehearsal: described('The rehearsal: the sweep drives the mount through every pose it could reach, with no frames', RehearsalSettings, {}),
})

export type SweepSettings = typeof SweepSettings.Type
