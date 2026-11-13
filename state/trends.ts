import { Schema } from 'effect'
import { isGuiderReport, isOperationObject, type GuiderReport, type RigEntry } from './entries.ts'
import type { Devices } from './devices.ts'
import type { WireBody } from './entry.ts'

export const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number })

export type Point = typeof Point.Type

const Line = Schema.Array(Point)

type Line = typeof Line.Type

export const Trends = Schema.Struct({
  target: Schema.optional(Schema.String),
  since: Schema.optional(Schema.Number),
  hfd: Line,
  stars: Line,
  guideRa: Line,
  guideDec: Line,
  airTemperature: Line,
  focuserTemperature: Line,
  humidity: Line,
  dewHeaters: Schema.Record(Schema.String, Line),
})

export type Trends = typeof Trends.Type

export const noTrends: Trends = {
  hfd: [],
  stars: [],
  guideRa: [],
  guideDec: [],
  airTemperature: [],
  focuserTemperature: [],
  humidity: [],
  dewHeaters: {},
}

const added = (line: Line, x: number, y: number | null | undefined): Line => (typeof y === 'number' ? [...line, { x, y }] : line)

function startedOver(state: Trends, object: string, at: number): Trends {
  return state.target === object ? state : { ...noTrends, target: object, since: at }
}

function guided(state: Trends, report: GuiderReport): Trends {
  if (report.body.Event !== 'GuideStep') return state

  return { ...state, guideRa: added(state.guideRa, report.at, report.body.RADistanceRaw), guideDec: added(state.guideDec, report.at, report.body.DECDistanceRaw) }
}

function dewHeatersReported(state: Trends, duty: Readonly<Record<string, number>> | undefined, at: number): Trends {
  const dewHeaters = Object.fromEntries(Object.entries(duty ?? {}).map(([channel, percent]) => [channel, added(state.dewHeaters[channel] ?? [], at, percent)]))

  return { ...state, dewHeaters: { ...state.dewHeaters, ...dewHeaters } }
}

function weatherReported(state: Trends, weather: NonNullable<Devices['box']['WEATHER_PARAMETERS']>['values'] | undefined, at: number): Trends {
  if (weather === undefined || Object.values(weather).every(value => value === 0)) return state

  return { ...state, airTemperature: added(state.airTemperature, at, weather.WEATHER_TEMPERATURE), humidity: added(state.humidity, at, weather.WEATHER_HUMIDITY) }
}

function deviceReported(state: Trends, wire: WireBody, at: number, devices: Devices): Trends {
  if (wire.dir !== 'in' || wire.type !== 'set') return state

  switch (`${wire.device} ${wire.property}`) {
    case 'box WEATHER_PARAMETERS':
      return weatherReported(state, devices.box.WEATHER_PARAMETERS?.values, at)
    case 'focuser FOCUS_TEMPERATURE':
      return { ...state, focuserTemperature: added(state.focuserTemperature, at, devices.focuser.FOCUS_TEMPERATURE?.values.TEMPERATURE) }
    case 'box DEW_DUTY_CYCLES':
      return dewHeatersReported(state, devices.box.DEW_DUTY_CYCLES?.values, at)
    default:
      return state
  }
}

export function trends(state: Trends, entry: RigEntry, devices: Devices): Trends {
  if (isGuiderReport(entry)) return guided(state, entry)

  switch (entry.kind) {
    case 'vela.run.started':
      return entry.body.frameType === 'light' && !isOperationObject(entry.body.object) ? startedOver(state, entry.body.object, entry.at) : state
    case 'vela.frame.stats':
      return { ...state, hfd: added(state.hfd, entry.at, entry.body.hfdPixels), stars: added(state.stars, entry.at, entry.body.stars) }
    case 'wire':
      return deviceReported(state, entry.body, entry.at, devices)
    default:
      return state
  }
}
