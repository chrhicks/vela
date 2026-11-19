import { Match } from 'effect'
import type { Done, GuidingSettle, NightStep, NudgeDirection, Refusal } from '../../../state/commands.ts'
import type { DeviceName } from '../../../state/devices.ts'
import type { RunEnding } from '../../../state/entries.ts'
import type { PierSide } from '../../../state/entries.ts'
import type { Rehearsal } from '../../../state/rehearsal.ts'
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

const nightStepWords: Readonly<Record<NightStep, string>> = { guiding: 'guiding off', home: 'home', tracking: 'tracking off', cooler: 'cooler off' }

const afterwards = (endedRun: boolean, stoppedGuiding: boolean | undefined) => {
  const done = [...(endedRun ? ['Run stopped'] : []), ...(stoppedGuiding === true ? ['guiding stopped'] : [])]

  return done.length === 0 ? {} : { toDo: done.join(' · ') }
}

const settleWords = (settle: GuidingSettle | undefined): string =>
  settle === undefined
    ? 'guiding restarted'
    : Match.value(settle).pipe(
        Match.when({ outcome: 'settled' }, () => 'guiding settled'),
        Match.when({ outcome: 'not-settled' }, ({ text }) => `guiding did not settle: ${text}`),
        Match.when({ outcome: 'no-word' }, ({ seconds }) => `no word from guiding in ${seconds} s`),
        Match.exhaustive,
      )

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
      'starting-target': ({ name, exposureSeconds, frames }) => ({ happened: `Starting ${name}`, toDo: frames === undefined ? `${exposureSeconds} s frames until stopped` : `${frames} × ${exposureSeconds} s` }),
      darks: ({ frames, exposureSeconds, celsius }) => ({ happened: `Darks ${frames} × ${exposureSeconds} s`, toDo: `at ${celsius} °C` }),
      'dark-flats': ({ frames, exposureSeconds, celsius }) => ({ happened: `Dark flats ${frames} × ${exposureSeconds} s`, toDo: `at ${celsius} °C` }),
      flats: ({ frames, celsius }) => ({ happened: `Flats ${frames} frames`, toDo: `at ${celsius} °C · finding the exposure` }),
      bias: ({ frames, celsius }) => ({ happened: `Bias ${frames} frames`, toDo: `at ${celsius} °C` }),
      autofocusing: ({ exposureSeconds, endedRun }) => ({ happened: `Autofocus at ${exposureSeconds} s`, ...(endedRun ? { toDo: 'Run stopped' } : {}) }),
      refocused: ({ exposureSeconds, ending }) => ({ happened: ending === 'done' ? `Refocused at ${exposureSeconds} s` : `Refocus ${ending}`, toDo: 'Run carried on' }),
      'rehearsing-sweep': ({ moves }) => ({ happened: 'Rehearsing the sweep', toDo: `${moves} moves, Stop ends it` }),
      reguided: () => ({ happened: 'Guiding settled on a new star', toDo: 'Run carried on' }),
      home: ({ endedRun, stoppedGuiding }) => ({ happened: 'Going home', ...afterwards(endedRun, stoppedGuiding) }),
      stop: ({ endedRun, stoppedGuiding }) => ({ happened: 'Stopped', ...afterwards(endedRun, stoppedGuiding) }),
      'stopped-for-night': ({ missed }) => ({ happened: 'Stopped for the night', ...(missed.length === 0 ? {} : { toDo: `not done: ${missed.map(step => nightStepWords[step]).join(', ')}` }) }),
      tracking: ({ on }) => ({ happened: on ? 'Tracking on' : 'Tracking off' }),
      centring: ({ target, endedRun, stoppedGuiding }) => ({ happened: `Centring ${target}`, ...afterwards(endedRun, stoppedGuiding) }),
      flip: ({ settled, flipped, pierSide, pausedRun, stoppedGuiding, restartedGuiding, guidingSettle }) => {
        const side = pierSide === undefined ? [] : [`pier ${pierSide}`]
        const guiding = stoppedGuiding === true ? [restartedGuiding === true ? settleWords(guidingSettle) : 'guiding off'] : []
        const run = [...guiding, ...(pausedRun ? ['run resumed'] : [])]

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

const pierWords: Readonly<Record<PierSide, string>> = { PIER_WEST: 'west', PIER_EAST: 'east' }

const counted = (count: number, what: string) => `${count} ${what}${count === 1 ? '' : 's'}`

const rehearsalFacts = ({ last, flipped, alerts, refused }: Rehearsal): ReadonlyArray<string> => [
  ...(last === undefined
    ? []
    : [
        `column ${last.column + 1}`,
        `alt ${Math.round(last.altitudeDegrees)}° az ${Math.round(last.azimuthDegrees)}°`,
        last.TELESCOPE_PIER_SIDE === undefined ? 'pier not reported' : `pier ${pierWords[last.TELESCOPE_PIER_SIDE]}`,
      ]),
  ...(flipped ? ['flipped'] : []),
  ...(alerts > 0 ? [counted(alerts, 'alert')] : []),
  ...(refused > 0 ? [`${refused} refused`] : []),
]

export const rehearsalWords = (state: Rehearsal): RefusalWords & { readonly troubled: boolean } => {
  const at = `move ${state.moved} of ${state.total}`
  const facts = rehearsalFacts(state)
  const troubled = state.last !== undefined && state.last.outcome !== 'arrived'

  return Match.value(state.ending).pipe(
    Match.when(undefined, () => ({ happened: `Rehearsing the sweep: ${at}`, ...(facts.length === 0 ? {} : { toDo: facts.join(' · ') }), troubled })),
    Match.when('finished', () => ({ happened: 'Sweep rehearsal done', toDo: `${counted(state.moved, 'move')}, ${counted(state.alerts, 'alert')}${state.refused > 0 ? `, ${state.refused} refused` : ''}`, troubled: state.alerts + state.refused > 0 })),
    Match.when('stopped', () => ({ happened: 'Sweep rehearsal stopped', toDo: `at ${at}${facts.length === 0 ? '' : ` · ${facts.join(' · ')}`}`, troubled: false })),
    Match.when('pressed', () => ({ happened: 'Sweep rehearsal ended by another press', toDo: `at ${at}`, troubled: false })),
    Match.when('restarted', () => ({ happened: 'Sweep rehearsal ended: Vela restarted', toDo: `at ${at}`, troubled: true })),
    Match.exhaustive,
  )
}

export const refusalWords = (refusal: Refusal): RefusalWords =>
  Match.value(refusal).pipe(
    Match.discriminatorsExhaustive('code')({
      refused: ({ text }) => ({ happened: text }),
      'not-connected': ({ device }) => ({ happened: `${deviceWords[device]} not connected` }),
      'not-reported': ({ device, property }) => ({ happened: `${deviceWords[device]} does not report ${property}` }),
      'no-answer': ({ seconds }) => ({ happened: `No answer ${seconds} s`, toDo: 'Check rig PC' }),
      'rig-refused': ({ text }) => ({ happened: 'Rig refused', toDo: text }),
      'guider-refused': ({ text }) => ({ happened: 'PHD2 refused', toDo: text }),
      'guider-silent': ({ seconds }) => ({ happened: `No reply from PHD2 ${seconds} s`, toDo: 'Check PHD2' }),
      'unknown-target': ({ text }) => ({ happened: `${text} not found`, toDo: 'Check the name' }),
      'run-active': () => ({ happened: 'Run active', toDo: 'See latest frame' }),
      'rehearsal-active': () => ({ happened: 'Sweep rehearsal going', toDo: 'Stop it first' }),
      'no-run': () => ({ happened: 'No run to pause' }),
      'rig-silent': ({ seconds }) => ({ happened: 'Rig silent', toDo: `nothing heard for ${seconds} s` }),
      'move-failed': ({ device }) => ({ happened: `${deviceWords[device]} did not move`, toDo: 'Driver refused the move' }),
      'out-of-range': ({ value, min, max }) => ({ happened: `${value} out of range`, toDo: `${min} to ${max}` }),
      malformed: () => ({ happened: 'Not understood' }),
      unreachable: () => ({ happened: 'No answer from Vela' }),
    }),
  )

export const mountWords: Readonly<Record<MountActivity, string>> = { parked: 'Parked', homing: 'Homing', slewing: 'Slewing', moving: 'Moving', tracking: 'Tracking', idle: 'Idle' }

export const guiderWords: Readonly<Record<GuiderActivity, string>> = {
  guiding: 'On',
  settling: 'Settling',
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
    Match.when('set-refused', () => ({ words: { happened: 'Flat set did not start', toDo: `exposure ${exposureSeconds} s was found` }, troubled: true })),
    Match.when('stopped', () => ({ words: { happened: 'Flats stopped', toDo: `at the ${exposureSeconds} s test` }, troubled: true })),
    Match.exhaustive,
  )
}
