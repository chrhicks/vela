import type { EdgeHow, FrameClass } from '../../state/entries.ts'
import type { SweepSettings } from './settings.ts'

export interface ColumnFrame {
  readonly commandedAltitudeDegrees: number
  readonly altitudeDegrees: number
  readonly class: FrameClass
}

export type ColumnStep =
  | { readonly step: 'frame'; readonly altitudeDegrees: number }
  | { readonly step: 'done'; readonly edgeAltitudeDegrees: number; readonly startAltitudeDegrees: number; readonly how: EdgeHow }

type ColumnSettings = Pick<SweepSettings, 'floorDegrees' | 'ceilingDegrees' | 'stepDegrees' | 'firstGuessDegrees'>

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

export const startAltitude = (previousEdgeDegrees: number | undefined, settings: ColumnSettings) => clamp(previousEdgeDegrees ?? settings.firstGuessDegrees, settings.floorDegrees, settings.ceilingDegrees)

export function nextInColumn(frames: ReadonlyArray<ColumnFrame>, settings: ColumnSettings): ColumnStep {
  const last = frames[frames.length - 1]

  if (last === undefined) return { step: 'frame', altitudeDegrees: startAltitude(undefined, settings) }

  const before = frames[frames.length - 2]

  if (before !== undefined && before.class !== last.class)
    return {
      step: 'done',
      edgeAltitudeDegrees: (before.altitudeDegrees + last.altitudeDegrees) / 2,
      startAltitudeDegrees: (before.commandedAltitudeDegrees + last.commandedAltitudeDegrees) / 2,
      how: 'between-frames',
    }

  if (last.class === 'sky') {
    if (last.commandedAltitudeDegrees <= settings.floorDegrees) return { step: 'done', edgeAltitudeDegrees: settings.floorDegrees, startAltitudeDegrees: settings.floorDegrees, how: 'open-to-floor' }

    return { step: 'frame', altitudeDegrees: Math.max(settings.floorDegrees, last.commandedAltitudeDegrees - settings.stepDegrees) }
  }

  if (last.commandedAltitudeDegrees >= settings.ceilingDegrees) return { step: 'done', edgeAltitudeDegrees: settings.ceilingDegrees, startAltitudeDegrees: settings.ceilingDegrees, how: 'blocked-to-ceiling' }

  return { step: 'frame', altitudeDegrees: Math.min(settings.ceilingDegrees, last.commandedAltitudeDegrees + settings.stepDegrees) }
}
