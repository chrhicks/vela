import { Schema } from 'effect'
import { isOperationObject, type GuiderReport, type RigEntry } from './entries.ts'
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

function dewHeatersReported(state: Trends, wire: WireBody, at: number): Trends {
  const dewHeaters = Object.fromEntries(Object.entries(wire.elements).map(([channel, percent]) => [channel, added(state.dewHeaters[channel] ?? [], at, typeof percent === 'number' ? percent : undefined)]))

  return { ...state, dewHeaters: { ...state.dewHeaters, ...dewHeaters } }
}

const boxHasRead = (elements: WireBody['elements']) => Object.values(elements).some(value => value !== 0)

function deviceReported(state: Trends, wire: WireBody, at: number): Trends {
  if (wire.dir !== 'in' || wire.type !== 'set') return state

  const number = (element: string) => {
    const value = wire.elements[element]

    return typeof value === 'number' ? value : undefined
  }

  switch (`${wire.device} ${wire.property}`) {
    case 'box WEATHER_PARAMETERS':
      return !boxHasRead(wire.elements) ? state : { ...state, airTemperature: added(state.airTemperature, at, number('WEATHER_TEMPERATURE')), humidity: added(state.humidity, at, number('WEATHER_HUMIDITY')) }
    case 'focuser FOCUS_TEMPERATURE':
      return { ...state, focuserTemperature: added(state.focuserTemperature, at, number('TEMPERATURE')) }
    case 'box DEW_DUTY_CYCLES':
      return dewHeatersReported(state, wire, at)
    default:
      return state
  }
}

const isGuiderReport = (entry: RigEntry): entry is GuiderReport => entry.kind.startsWith('phd2.')

export function trends(state: Trends, entry: RigEntry): Trends {
  if (isGuiderReport(entry)) return guided(state, entry)

  switch (entry.kind) {
    case 'vela.run.started':
      return entry.body.frameType === 'light' && !isOperationObject(entry.body.object) ? startedOver(state, entry.body.object, entry.at) : state
    case 'vela.frame.stats':
      return { ...state, hfd: added(state.hfd, entry.at, entry.body.hfdPixels), stars: added(state.stars, entry.at, entry.body.stars) }
    case 'wire':
      return deviceReported(state, entry.body, entry.at)
    default:
      return state
  }
}
