import { Option, Result, Schema } from 'effect'
import type { CoolerSetting, ShortlistAction } from '../../state/commands.ts'
import { operationObjects, readRigEntry } from '../../state/entries.ts'
import type { Entry } from '../../state/entry.ts'
import { angularDistance } from '../../state/angles.ts'
import { type EquatorialPosition } from '../sky/coordinates.ts'

export interface LastLight {
  readonly exposureSeconds: number
  readonly frames: number | undefined
  readonly at: number
}

export interface Centre extends EquatorialPosition {
  readonly run: string
  readonly at: number
  readonly reached: boolean
}

export interface CoolerCamera {
  readonly on: boolean | undefined
  readonly setpoint: number | undefined
  readonly sensorCelsius: number | undefined
  readonly wrote: number
}

export interface CoolerAtStart {
  readonly setting: CoolerSetting
  readonly at: number
}

export interface TargetCooler extends CoolerAtStart {
  readonly target: string
}

export interface LightTarget {
  readonly target: string
  readonly at: number
}

export interface LightRun extends LightTarget {
  readonly run: string
}

export interface ShortlistEdit {
  readonly target: string
  readonly action: ShortlistAction
  readonly from?: ReadonlyArray<string>
}

export interface Remembered {
  readonly lastLight: LastLight | undefined
  readonly cameraAngle: { readonly degrees: number; readonly at: number } | undefined
  readonly centres: ReadonlyArray<Centre>
  readonly camera: CoolerCamera | undefined
  readonly targetCoolers: ReadonlyArray<TargetCooler>
  readonly lastCooler: CoolerAtStart | undefined
  readonly lightRun: LightRun | undefined
  readonly lightTargets: ReadonlyArray<LightTarget>
  readonly shortlist: ReadonlyArray<string> | undefined
}

export const nothingRemembered: Remembered = { lastLight: undefined, cameraAngle: undefined, centres: [], camera: undefined, targetCoolers: [], lastCooler: undefined, lightRun: undefined, lightTargets: [], shortlist: undefined }

const SolvedPass = Schema.Struct({
  run: Schema.String,
  solved: Schema.Literal(true),
  raDegrees: Schema.Finite,
  decDegrees: Schema.Finite,
  rotationDegrees: Schema.optionalKey(Schema.Finite),
})

const decodeSolvedPass = Schema.decodeUnknownResult(SolvedPass)

const later = <Timed extends { readonly at: number }>(known: Timed | undefined, seen: Timed) => (known === undefined || seen.at >= known.at ? seen : known)

function passed(state: Remembered, entry: Entry): Remembered {
  return Result.match(decodeSolvedPass(entry.body), {
    onFailure: () => state,
    onSuccess: ({ run, raDegrees, decDegrees, rotationDegrees }) => {
      const before = state.centres.find(centre => centre.run === run)
      const centre: Centre = later(before, { run, raDegrees, decDegrees, at: entry.at, reached: before?.reached ?? false })

      return {
        ...state,
        cameraAngle: rotationDegrees === undefined ? state.cameraAngle : later(state.cameraAngle, { degrees: rotationDegrees, at: entry.at }),
        centres: [...state.centres.filter(known => known.run !== run), centre],
      }
    },
  })
}

const CentringSolve = Schema.Struct({
  header: Schema.Struct({ OBJECT: Schema.Literal(operationObjects.centre) }),
  solve: Schema.Struct({ solved: Schema.Literal(true), wcs: Schema.Struct({ CROTA2: Schema.Finite }) }),
})

const decodeCentringSolve = Schema.decodeUnknownResult(CentringSolve)

const solvedForCentring = (state: Remembered, entry: Entry): Remembered =>
  Result.match(decodeCentringSolve(entry.body), {
    onFailure: () => state,
    onSuccess: ({ solve }) => ({ ...state, cameraAngle: later(state.cameraAngle, { degrees: solve.wcs.CROTA2, at: entry.at }) }),
  })

const CameraReported = Schema.Union([
  Schema.Struct({ dir: Schema.Literal('out'), device: Schema.Literal('primary'), property: Schema.Literal('CCD_COOLER'), elements: Schema.Struct({ COOLER_ON: Schema.Boolean }) }),
  Schema.Struct({ dir: Schema.Literal('out'), device: Schema.Literal('primary'), property: Schema.Literal('CCD_TEMPERATURE'), elements: Schema.Struct({ CCD_TEMPERATURE_VALUE: Schema.Finite }) }),
  Schema.Struct({ dir: Schema.Literal('in'), device: Schema.Literal('primary'), property: Schema.Literal('CCD_TEMPERATURE'), elements: Schema.Struct({ CCD_TEMPERATURE_VALUE: Schema.Finite }) }),
])

const decodeCameraReported = Schema.decodeUnknownResult(CameraReported)

const coolerCamera = (state: Remembered, entry: Entry): Remembered =>
  Result.match(decodeCameraReported(entry.body), {
    onFailure: () => state,
    onSuccess: wire => {
      const camera = state.camera ?? { on: undefined, setpoint: undefined, sensorCelsius: undefined, wrote: entry.at }

      if (wire.dir === 'in') {
        if (camera.on !== true || camera.setpoint !== undefined) return state

        const sensorCelsius = Math.round(wire.elements.CCD_TEMPERATURE_VALUE)

        return sensorCelsius === camera.sensorCelsius ? state : { ...state, camera: { ...camera, sensorCelsius } }
      }

      if (entry.at < camera.wrote) return state

      return { ...state, camera: wire.property === 'CCD_COOLER' ? { ...camera, on: wire.elements.COOLER_ON, wrote: entry.at } : { ...camera, setpoint: wire.elements.CCD_TEMPERATURE_VALUE, wrote: entry.at } }
    },
  })

function coolerAt(camera: CoolerCamera | undefined, at: number): CoolerSetting | undefined {
  if (camera === undefined || camera.wrote > at || camera.on === undefined) return undefined
  if (!camera.on) return { state: 'off' }

  const celsius = camera.setpoint ?? camera.sensorCelsius

  return celsius === undefined ? undefined : { state: 'on', celsius }
}

function lightStarted(state: Remembered, start: { readonly at: number; readonly target: string | undefined }): Remembered {
  const setting = coolerAt(state.camera, start.at)

  if (setting === undefined || setting.state === 'off') return state

  const seen: CoolerAtStart = { setting, at: start.at }
  const before = state.targetCoolers.find(known => known.target === start.target)

  return {
    ...state,
    lastCooler: later(state.lastCooler, seen),
    targetCoolers: start.target === undefined ? state.targetCoolers : [...state.targetCoolers.filter(known => known !== before), { target: start.target, ...later(before, seen) }],
  }
}

function lightExposed(state: Remembered, run: string): Remembered {
  const { lightRun } = state

  if (lightRun === undefined || lightRun.run !== run) return state

  const before = state.lightTargets.find(known => known.target === lightRun.target)

  return { ...state, lightTargets: [...state.lightTargets.filter(known => known !== before), later(before, { target: lightRun.target, at: lightRun.at })] }
}

export function withShortlistEdit(state: Remembered, { target, action, from }: ShortlistEdit): Remembered {
  const base = state.shortlist ?? from ?? []

  if (action === 'add') return base.includes(target) && state.shortlist !== undefined ? state : { ...state, shortlist: base.includes(target) ? base : [...base, target] }

  return base.includes(target) || state.shortlist === undefined ? { ...state, shortlist: base.filter(known => known !== target) } : state
}

export function recentLightTargets(state: Remembered, count: number, listable: (id: string) => boolean): ReadonlyArray<string> {
  const imaged = new Set(state.lightTargets.map(known => known.target))
  const seeded = state.targetCoolers.filter(cooler => !imaged.has(cooler.target)).map(cooler => ({ target: cooler.target, at: cooler.at }))

  return [...state.lightTargets, ...seeded]
    .filter(known => listable(known.target))
    .sort((a, b) => b.at - a.at)
    .slice(0, count)
    .map(known => known.target)
}

export const shortlistOf = (state: Remembered, count: number, listable: (id: string) => boolean): ReadonlyArray<string> => state.shortlist ?? recentLightTargets(state, count, listable)

export function remember(state: Remembered, entry: Entry): Remembered {
  if (entry.kind === 'vela.centre.pass') return passed(state, entry)
  if (entry.kind === 'client.measure') return solvedForCentring(state, entry)
  if (entry.kind === 'wire') return coolerCamera(state, entry)

  const read = Result.match(readRigEntry(entry), { onFailure: () => undefined, onSuccess: Option.getOrUndefined })

  if (read?.kind === 'vela.run.started') {
    if (read.body.frameType !== 'light' || read.body.object._tag !== 'Target') return state.lightRun === undefined ? state : { ...state, lightRun: undefined }

    const lit: Remembered = {
      ...state,
      lastLight: later(state.lastLight, { exposureSeconds: read.body.exposureSeconds, frames: read.body.count, at: read.at }),
      lightRun: read.body.target === undefined ? undefined : { run: read.body.run, target: read.body.target.id, at: read.at },
    }

    return lightStarted(lit, { at: read.at, target: read.body.target?.id })
  }

  if (read?.kind === 'vela.run.exposed') return lightExposed(state, read.body.run)

  if (read?.kind === 'vela.shortlist') return withShortlistEdit(state, read.body)

  if (read?.kind === 'vela.run.ended' && read.body.reason === 'done') {
    return { ...state, centres: state.centres.map(centre => (centre.run === read.body.run ? { ...centre, reached: true } : centre)) }
  }

  return state
}

export function coolerFor(state: Remembered, target: string): CoolerAtStart | undefined {
  const known = state.targetCoolers.find(cooler => cooler.target === target)

  return known === undefined ? state.lastCooler : { setting: known.setting, at: known.at }
}

export function lastCentreNear(state: Remembered, position: EquatorialPosition, withinDegrees: number): Centre | undefined {
  return state.centres
    .filter(centre => centre.reached && angularDistance(centre, position) <= withinDegrees)
    .reduce<Centre | undefined>((latest, centre) => later(latest, centre), undefined)
}
