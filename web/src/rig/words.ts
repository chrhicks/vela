import { Match } from 'effect'
import type { Flip } from '../../../state/flip.ts'
import type { GuiderActivity, Guiding } from '../../../state/guiding.ts'
import type { MountActivity } from '../../../state/devices.ts'

export const unknown = '—'

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
