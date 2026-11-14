import { Match } from 'effect'
import type { Done, NudgeDirection, Refusal } from '../../../state/commands.ts'
import type { DeviceName } from '../../../state/devices.ts'
import type { RunEnding } from '../../../state/entries.ts'
import type { FlatExposure } from '../../../state/flats.ts'
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

export const doneWords = (done: Done): RefusalWords =>
  Match.value(done).pipe(
    Match.discriminatorsExhaustive('code')({
      'carried-out': () => ({ happened: 'Done' }),
      'guiding-starting': ({ recalibrate }) => ({ happened: recalibrate ? 'Calibrating, then guiding' : 'Guiding starting', toDo: 'PHD2 has the command' }),
      'guiding-stopped': () => ({ happened: 'Guiding stopped' }),
      focusing: ({ position }) => ({ happened: `Moving to ${position}`, toDo: 'still moving' }),
      focused: ({ position }) => ({ happened: `At ${position}` }),
      cooling: ({ celsius }) => ({ happened: `Cooling to ${celsius} °C` }),
      'cooler-off': () => ({ happened: 'Cooler off' }),
      'dew-auto': () => ({ happened: 'Dew heater on auto' }),
      'dew-fixed': ({ percent }) => ({ happened: `Dew heater at ${percent} %` }),
      'dew-off': () => ({ happened: 'Dew heater off' }),
      'test-frame': ({ exposureSeconds }) => ({ happened: `Test frame ${exposureSeconds} s` }),
      darks: ({ frames, exposureSeconds, celsius }) => ({ happened: `Darks ${frames} × ${exposureSeconds} s`, toDo: `at ${celsius} °C` }),
      'dark-flats': ({ frames, exposureSeconds, celsius }) => ({ happened: `Dark flats ${frames} × ${exposureSeconds} s`, toDo: `at ${celsius} °C` }),
      flats: ({ frames, celsius }) => ({ happened: `Flats ${frames} frames`, toDo: `at ${celsius} °C · finding the exposure` }),
      bias: ({ frames, celsius }) => ({ happened: `Bias ${frames} frames`, toDo: `at ${celsius} °C` }),
      autofocusing: ({ exposureSeconds, endedRun }) => ({ happened: `Autofocus at ${exposureSeconds} s`, ...(endedRun ? { toDo: 'Run stopped' } : {}) }),
      home: ({ endedRun }) => ({ happened: 'Going home', ...(endedRun ? { toDo: 'Run stopped' } : {}) }),
      stop: ({ endedRun }) => ({ happened: 'Stopped', ...(endedRun ? { toDo: 'Run stopped' } : {}) }),
      tracking: ({ on }) => ({ happened: on ? 'Tracking on' : 'Tracking off' }),
      centring: ({ target, endedRun }) => ({ happened: `Centring ${target}`, ...(endedRun ? { toDo: 'Run stopped' } : {}) }),
      flip: ({ settled, flipped, pierSide, pausedRun }) => {
        const side = pierSide === undefined ? [] : [`pier ${pierSide}`]
        const run = pausedRun ? ['run resumed'] : []

        if (!settled) return { happened: 'Flip sent', toDo: ['mount still moving', ...run].join(' · ') }

        return { happened: flipped ? 'Flipped' : 'No flip', toDo: [...side, ...run].join(' · ') }
      },
    }),
  )

export const autofocusEndWords = (ending: RunEnding, best: number | undefined, current: number | undefined): RefusalWords =>
  Match.value(ending).pipe(
    Match.when('done', () => ({ happened: 'Autofocus done', ...(best === undefined ? {} : { toDo: `at ${best}` }) })),
    Match.when('refused', () => ({ happened: 'Autofocus found no focus', ...(current === undefined ? {} : { toDo: `back at ${current}` }) })),
    Match.when('stopped', () => ({ happened: 'Autofocus stopped' })),
    Match.orElse(() => ({ happened: 'Autofocus ended', toDo: ending })),
  )

export const refusalWords = (refusal: Refusal): RefusalWords =>
  Match.value(refusal).pipe(
    Match.discriminatorsExhaustive('code')({
      refused: ({ text }) => ({ happened: text }),
      'not-connected': ({ device }) => ({ happened: `${deviceWords[device]} not connected` }),
      'no-answer': ({ seconds }) => ({ happened: `No answer ${seconds} s`, toDo: 'Check rig PC' }),
      'rig-refused': ({ text }) => ({ happened: 'Rig refused', toDo: text }),
      'guider-refused': ({ text }) => ({ happened: 'PHD2 refused', toDo: text }),
      'guider-silent': ({ seconds }) => ({ happened: `No reply from PHD2 ${seconds} s`, toDo: 'Check PHD2' }),
      'unknown-target': ({ text }) => ({ happened: `${text} not found`, toDo: 'Check the name' }),
      'run-active': () => ({ happened: 'Run active', toDo: 'See latest frame' }),
      'move-failed': ({ device }) => ({ happened: `${deviceWords[device]} did not move`, toDo: 'Driver refused the move' }),
      'out-of-range': ({ value, min, max }) => ({ happened: `${value} out of range`, toDo: `${min} to ${max}` }),
      malformed: () => ({ happened: 'Not understood' }),
      unreachable: () => ({ happened: 'No answer from Vela' }),
    }),
  )

export const mountWords: Readonly<Record<MountActivity, string>> = { parked: 'Parked', homing: 'Homing', slewing: 'Slewing', moving: 'Moving', tracking: 'Tracking', idle: 'Idle' }

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

export const flatExposureWords = ({ exposureSeconds, sky, verdict, nextSeconds }: FlatExposure): { readonly words: RefusalWords; readonly troubled: boolean } => {
  const gave = sky === undefined ? `${exposureSeconds} s` : `${exposureSeconds} s gave ${Math.round(sky).toLocaleString('en-US')}`

  return Match.value(verdict).pipe(
    Match.when('trying', () => ({ words: { happened: `Flat test ${gave}`, ...(nextSeconds === undefined ? {} : { toDo: `trying ${nextSeconds} s` }) }, troubled: false })),
    Match.when('good', () => ({ words: { happened: `Flat exposure ${exposureSeconds} s`, toDo: sky === undefined ? 'taking the set' : `median ${Math.round(sky).toLocaleString('en-US')} · taking the set` }, troubled: false })),
    Match.when('too-dark', () => ({ words: { happened: 'Too dark for flats', toDo: gave }, troubled: true })),
    Match.when('too-bright', () => ({ words: { happened: 'Too bright for flats', toDo: gave }, troubled: true })),
    Match.when('gave-up', () => ({ words: { happened: 'No flat exposure found', toDo: `last test ${gave}` }, troubled: true })),
    Match.when('not-measured', () => ({ words: { happened: 'Flat test was not measured', toDo: gave }, troubled: true })),
    Match.when('stopped', () => ({ words: { happened: 'Flats stopped', toDo: `at the ${exposureSeconds} s test` }, troubled: true })),
    Match.exhaustive,
  )
}
