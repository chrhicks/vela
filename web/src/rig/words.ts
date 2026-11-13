import { Match } from 'effect'
import type { NudgeDirection, Refusal } from '../../../state/commands.ts'
import type { DeviceName } from '../../../state/devices.ts'
import type { Flip } from '../../../state/flip.ts'
import type { GuiderActivity, Guiding } from '../../../state/guiding.ts'
import type { MountActivity } from '../../../state/devices.ts'

export const unknown = '—'

export const nudgeWords: Readonly<Record<NudgeDirection, 'N' | 'S' | 'E' | 'W'>> = { north: 'N', south: 'S', east: 'E', west: 'W' }

export const deviceWords: Readonly<Record<DeviceName, string>> = { mount: 'Mount', primary: 'Camera', focuser: 'Focuser', box: 'Power box', guide: 'Guide cam' }

export interface RefusalWords {
  readonly happened: string
  readonly toDo?: string
}

export const refusalWords = (refusal: Refusal): RefusalWords =>
  Match.value(refusal).pipe(
    Match.discriminatorsExhaustive('code')({
      refused: ({ text }) => ({ happened: text }),
      'not-connected': ({ device }) => ({ happened: `${deviceWords[device]} not connected` }),
      'no-answer': ({ seconds }) => ({ happened: `No answer ${seconds} s`, toDo: 'Check rig PC' }),
      'rig-refused': ({ text }) => ({ happened: 'Rig refused', toDo: text }),
      malformed: () => ({ happened: 'Not understood' }),
      unreachable: () => ({ happened: 'No answer from Vela' }),
    }),
  )

export const mountWords: Readonly<Record<MountActivity, string>> = { parked: 'Parked', slewing: 'Slewing', tracking: 'Tracking', idle: 'Idle' }

export const guiderWords: Readonly<Record<GuiderActivity, string>> = {
  guiding: 'On',
  looping: 'Looping',
  calibrating: 'Calibrating',
  starPicked: 'Star picked',
  starLost: 'Star lost',
  paused: 'Paused',
  stopped: 'Off',
}

export function guidingWord({ link, activity, averagePixels }: Guiding): string {
  if (link === 'closed') return 'PHD2 off'
  if (activity === undefined) return unknown
  if (activity === 'guiding' && averagePixels !== undefined) return `${guiderWords.guiding} ${averagePixels.toFixed(2)} px`

  return guiderWords[activity]
}

export function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const hours = Math.floor(minutes / 60)

  return hours === 0 ? `${minutes} min` : `${hours} h ${String(minutes % 60).padStart(2, '0')}`
}

export const flipWord = (time: Flip): string =>
  Match.valueTags(time, {
    Unknown: () => unknown,
    NotTracking: () => 'Not tracking',
    NoneThisSide: () => 'None',
    In: ({ seconds }) => `In ${duration(seconds)}`,
    Past: ({ seconds }) => `Past ${duration(seconds)}`,
  })
