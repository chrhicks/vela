import { Schema } from 'effect'

export const hourMs = 3_600_000
const dayHours = 24

const intervalPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\/P(?=\d|T\d)(?:(\d+)D)?(?:T(\d+)H)?$/

const startOf = (text: string) => Date.parse(intervalPattern.exec(text)?.[1] ?? '')

export const ValidInterval = Schema.String.check(
  Schema.isPattern(intervalPattern),
  Schema.makeFilter((text: string) => Number.isFinite(startOf(text))),
).pipe(Schema.brand('ValidInterval'))

export type ValidInterval = typeof ValidInterval.Type

export const hourStart = (at: number): number => Math.floor(at / hourMs) * hourMs

export function hoursOf(interval: ValidInterval): ReadonlyArray<number> {
  const parts = intervalPattern.exec(interval)
  const count = Number(parts?.[2] ?? 0) * dayHours + Number(parts?.[3] ?? 0)
  const first = hourStart(startOf(interval))

  return Array.from({ length: count }, (_, index) => first + index * hourMs)
}

export const NwsGridPoint = Schema.Struct({
  properties: Schema.Struct({ gridId: Schema.NonEmptyString, gridX: Schema.Int, gridY: Schema.Int }),
})

export type NwsGridPoint = typeof NwsGridPoint.Type

export const NwsGridData = Schema.Struct({
  properties: Schema.Struct({
    skyCover: Schema.Struct({
      values: Schema.Array(Schema.Struct({ validTime: ValidInterval, value: Schema.NullOr(Schema.Number) })),
    }),
  }),
})

export type NwsGridData = typeof NwsGridData.Type

export const OpenMeteoAnswer = Schema.Struct({
  hourly: Schema.Struct({
    time: Schema.Array(Schema.Number),
    cloud_cover: Schema.Array(Schema.NullOr(Schema.Number)),
  }),
})

export type OpenMeteoAnswer = typeof OpenMeteoAnswer.Type

export function nwsCover(data: NwsGridData): ReadonlyMap<number, number> {
  const cover = new Map<number, number>()

  for (const { validTime, value } of data.properties.skyCover.values) {
    if (value === null) continue

    for (const hour of hoursOf(validTime)) cover.set(hour, value)
  }

  return cover
}

export function openMeteoCover(answer: OpenMeteoAnswer): ReadonlyMap<number, number> {
  const cover = new Map<number, number>()

  answer.hourly.time.forEach((seconds, index) => {
    const value = answer.hourly.cloud_cover[index]

    if (value !== undefined && value !== null) cover.set(hourStart(seconds * 1000), value)
  })

  return cover
}
