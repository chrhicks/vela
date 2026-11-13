import { Schema } from 'effect'
import { isGuiderReport, type GuiderEvent, type GuiderReport, type LinkStatus, type RigEntry } from './entries.ts'

export const GuiderActivity = Schema.Literals(['guiding', 'looping', 'calibrating', 'starPicked', 'starLost', 'paused', 'stopped'])

export type GuiderActivity = typeof GuiderActivity.Type

export const GuiderLink = Schema.Literals(['unknown', 'connected', 'closed'])

export const Guiding = Schema.Struct({
  link: GuiderLink,
  activity: Schema.optional(GuiderActivity),
  averagePixels: Schema.optional(Schema.Number),
  starSnr: Schema.optional(Schema.Number),
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

function guiderLinkChanged(state: Guiding, status: LinkStatus): Guiding {
  if (status === 'connected') return state.link === 'connected' ? state : { ...state, link: 'connected' }

  return state.link === 'closed' && state.activity === undefined ? state : { link: 'closed' }
}

function guiderReported(state: Guiding, report: GuiderReport['body'], at: number): Guiding {
  const activity = activityOf[report.Event]
  const guided = activity === 'guiding'

  return {
    link: 'connected',
    activity,
    averagePixels: guided ? (report.AvgDist ?? state.averagePixels) : undefined,
    starSnr: guided ? (report.SNR ?? state.starSnr) : undefined,
    at,
  }
}

export function guiding(state: Guiding, entry: RigEntry): Guiding {
  if (isGuiderReport(entry)) return guiderReported(state, entry.body, entry.at)
  if (entry.kind === 'client.connected') return unknownGuiding
  if (entry.kind === 'client.connection' && entry.body.target === 'phd2') return guiderLinkChanged(state, entry.body.status)

  return state
}
