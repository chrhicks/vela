import type { SkyPosition } from '../../state/entries.ts'
import type { ReviewLine } from '../../state/review-answer.ts'
import { altitudeAt, type Horizon } from '../horizon/horizon.ts'
import type { PlateSolution } from '../frames/stats.ts'
import type { Site } from '../pointing/target.ts'
import { horizontalOfJ2000 } from '../sky/horizontal.ts'
import { toSky } from '../stack/tan.ts'

export interface FrameView {
  readonly at: number
  readonly site: Site
  readonly columns: number
  readonly rows: number
  readonly heightDegrees: number
  readonly mount: SkyPosition
  readonly solution: PlateSolution | null
}

const tenths = (value: number) => Math.round(value * 10) / 10

const marginAt = (horizon: Horizon, position: SkyPosition, view: FrameView): number | undefined => {
  const { altitudeDegrees, azimuthDegrees } = horizontalOfJ2000(position, view.at, view.site)
  const line = altitudeAt(horizon, azimuthDegrees)

  return line === null ? undefined : altitudeDegrees - line
}

const outline = ({ columns, rows }: FrameView) => {
  const [left, right, top, bottom, middleX, middleY] = [1, columns, 1, rows, (columns + 1) / 2, (rows + 1) / 2]

  return [
    { x: left, y: top },
    { x: middleX, y: top },
    { x: right, y: top },
    { x: right, y: middleY },
    { x: right, y: bottom },
    { x: middleX, y: bottom },
    { x: left, y: bottom },
    { x: left, y: middleY },
  ]
}

export function lineOf(view: FrameView, horizon: Horizon): ReviewLine | undefined {
  const { solution } = view

  if (solution !== null) {
    const centre = marginAt(horizon, toSky(solution, { x: (view.columns + 1) / 2, y: (view.rows + 1) / 2 }), view)

    if (centre === undefined) return undefined

    const around = outline(view).flatMap(pixel => marginAt(horizon, toSky(solution, pixel), view) ?? [])

    return { centreDegrees: tenths(centre), lowestDegrees: tenths(Math.min(centre, ...around)), heightDegrees: tenths(view.heightDegrees), source: 'solve' }
  }

  const centre = marginAt(horizon, view.mount, view)

  if (centre === undefined) return undefined

  const reach = (view.heightDegrees * Math.hypot(view.columns, view.rows)) / view.rows / 2

  return { centreDegrees: tenths(centre), lowestDegrees: tenths(centre - reach), heightDegrees: tenths(view.heightDegrees), source: 'mount' }
}

const degreesWords = (value: number) => `${value} ${value === 1 ? 'degree' : 'degrees'}`

export function horizonSentence({ centreDegrees, heightDegrees }: Pick<ReviewLine, 'centreDegrees' | 'heightDegrees'>): string {
  const centre = Math.abs(centreDegrees)
  const where = centre === 0 ? 'level with' : `${degreesWords(centre)} ${centreDegrees > 0 ? 'above' : 'below'}`

  return `The frame's centre is ${where} the mapped tree line in its direction, and the frame is about ${degreesWords(heightDegrees)} tall.`
}
