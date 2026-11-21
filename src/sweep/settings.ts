import { Schema } from 'effect'
import { described } from '../config.ts'

const Positive = Schema.Number.check(Schema.isGreaterThan(0))

const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

const Fraction = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

const PositiveCount = Schema.Int.check(Schema.isGreaterThan(0))

export const RehearsalSettings = Schema.Struct({
  columnDegrees: described('The azimuth, in degrees, between two neighbouring columns of the rehearsal', Positive, 15),
  rowDegrees: described('The altitude, in degrees, between two stops down a column of the rehearsal, before each stop is split into steps by the axis limit', Positive, 5),
})

export const CellSettings = Schema.Struct({
  columns: described('How many cells a frame is split into across its width', PositiveCount, 4),
  rows: described('How many cells a frame is split into down its height', PositiveCount, 3),
  blockedBelow: described('A cell with fewer stars than this share of the clear-sky star count of a cell is blocked', Fraction, 0.15),
  partlyBlockedBelow: described('A cell with fewer stars than this share of the clear-sky star count of a cell, and not blocked, is partly blocked; the rest are sky', Fraction, 0.65),
  clearTopFraction: described("The share of a frame's cells, most stars first, whose median star count is the frame's own clear-sky star count of a cell", Fraction.check(Schema.isGreaterThan(0)), 0.1),
  edgeBinDegrees: described('The width, in degrees of azimuth, of one bin of the edge', Positive, 1),
})

export type CellSettings = typeof CellSettings.Type

export const SweepSettings = Schema.Struct({
  columnDegrees: described('The azimuth, in degrees, between two neighbouring columns of the sweep', Positive, 2.5),
  legDegrees: described('The most, in degrees, either mount axis (hour angle or declination) turns in one step of a move', Positive, 5),
  floorDegrees: described('The lowest altitude, in degrees, a column reaches', Schema.Number, 2),
  ceilingDegrees: described('The highest altitude, in degrees, a column reaches', Schema.Number, 70),
  settleSeconds: described('The pause, in seconds, after the last step of a move before the frame is taken', NonNegative, 1),
  stepDegrees: described('How far, in degrees of altitude, the next frame of a column is from the last: lower after sky, higher after blocked', Positive, 2),
  firstGuessDegrees: described('The altitude, in degrees, the first column starts at; later columns start at the edge the column before found', Schema.Number, 25),
  alertAfterFrames: described('How many frames in one column publish an alert; the column carries on', PositiveCount, 8),
  baselineAltitudeDegrees: described('How close in altitude, in degrees, a solved frame must be to count in the baseline star count of a frame', Positive, 10),
  baselineTopFraction: described('The share of the nearby solved frames, highest star counts first, whose median is the baseline star count', Fraction.check(Schema.isGreaterThan(0)), 0.25),
  baselineMinFrames: described('The fewest nearby solved frames the baseline is taken from; with fewer it is the highest star count of any solved frame so far', PositiveCount, 3),
  recordDir: described('The folder the sweep keeps one folder per night in, each with frames.jsonl and columns.jsonl', Schema.String, '/mnt/storage/rig/horizon'),
  cells: described('The cells a kept sweep frame is split into on thuban, and how each is labelled', CellSettings, {}),
  rehearsal: described('The rehearsal: the sweep drives the mount through every pose it could reach, with no frames', RehearsalSettings, {}),
})

export type SweepSettings = typeof SweepSettings.Type
