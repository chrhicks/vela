import { Option, Result, Schema } from 'effect'
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

export interface Remembered {
  readonly lastLight: LastLight | undefined
  readonly cameraAngle: { readonly degrees: number; readonly at: number } | undefined
  readonly centres: ReadonlyArray<Centre>
}

export const nothingRemembered: Remembered = { lastLight: undefined, cameraAngle: undefined, centres: [] }

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

export function remember(state: Remembered, entry: Entry): Remembered {
  if (entry.kind === 'vela.centre.pass') return passed(state, entry)
  if (entry.kind === 'client.measure') return solvedForCentring(state, entry)

  const read = Result.match(readRigEntry(entry), { onFailure: () => undefined, onSuccess: Option.getOrUndefined })

  if (read?.kind === 'vela.run.started' && read.body.frameType === 'light' && read.body.object._tag === 'Target') {
    return { ...state, lastLight: later(state.lastLight, { exposureSeconds: read.body.exposureSeconds, frames: read.body.count, at: read.at }) }
  }

  if (read?.kind === 'vela.run.ended' && read.body.reason === 'done') {
    return { ...state, centres: state.centres.map(centre => (centre.run === read.body.run ? { ...centre, reached: true } : centre)) }
  }

  return state
}

export function lastCentreNear(state: Remembered, position: EquatorialPosition, withinDegrees: number): Centre | undefined {
  return state.centres
    .filter(centre => centre.reached && angularDistance(centre, position) <= withinDegrees)
    .reduce<Centre | undefined>((latest, centre) => later(latest, centre), undefined)
}
