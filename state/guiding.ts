import { Schema } from 'effect'
import type { GuiderEvent, GuiderReport, RigEntry } from './entries.ts'

export const GuiderActivity = Schema.Literals(['guiding', 'looping', 'calibrating', 'starPicked', 'starLost', 'paused', 'stopped'])

export type GuiderActivity = typeof GuiderActivity.Type

export const GuiderLink = Schema.Literals(['unknown', 'connected', 'closed'])

export const Guiding = Schema.Struct({
  link: GuiderLink,
  activity: Schema.optional(GuiderActivity),
  averagePixels: Schema.optional(Schema.Number),
  at: Schema.optional(Schema.Number),
})

export type Guiding = typeof Guiding.Type

export const unknownGuiding: Guiding = { link: 'unknown' }

const activityOf: Readonly<Record<GuiderEvent, GuiderActivity>> = {
  GuideStep: 'guiding',
  StartGuiding: 'guiding',
  Resumed: 'guiding',
  GuidingStopped: 'stopped',
  LoopingExposuresStopped: 'stopped',
  LoopingExposures: 'looping',
  StartCalibration: 'calibrating',
  StarSelected: 'starPicked',
  StarLost: 'starLost',
  Paused: 'paused',
}

function guiderLinkChanged(state: Guiding, status: string): Guiding {
  if (status === 'connected') return state.link === 'connected' ? state : { ...state, link: 'connected' }

  return state.link === 'closed' && state.activity === undefined ? state : { link: 'closed' }
}

function guiderReported(state: Guiding, event: GuiderEvent, averagePixels: number | undefined, at: number): Guiding {
  const activity = activityOf[event]

  return { link: 'connected', activity, averagePixels: activity === 'guiding' ? (averagePixels ?? state.averagePixels) : undefined, at }
}

const isGuiderReport = (entry: RigEntry): entry is GuiderReport => entry.kind.startsWith('phd2.')

export function guiding(state: Guiding, entry: RigEntry): Guiding {
  if (isGuiderReport(entry)) return guiderReported(state, entry.body.Event, entry.body.AvgDist, entry.at)
  if (entry.kind === 'client.connected') return unknownGuiding
  if (entry.kind === 'client.connection' && entry.body.target === 'phd2') return guiderLinkChanged(state, entry.body.status)

  return state
}
