import { Schema } from 'effect'
import { exposureMiddle } from '../align/run.ts'
import type { Between, StartResult } from '../capture/run.ts'
import { decodeConfig } from '../config.ts'
import type { Measured, Measurement } from '../measure/rig.ts'
import type { PrepareResult } from '../prepare/prepare.ts'
import type { Picture } from '../rig/picture.ts'
import { angularDistance, fromMount, toMount, type EquatorialPosition } from '../sky/coordinates.ts'
import { recordOf, type Entry } from '../../state/entry.ts'
import type { Pointing } from './pointing.ts'

export const centreSubject = 'rig-dev.vela.centre'

const Request = Schema.Struct({ id: Schema.String, exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)) })

export interface CentreSettings {
  readonly mount: string
  readonly camera: string
  readonly toleranceArcmin: number
}

export interface CentreOptions {
  readonly picture: Pick<Picture, 'property'>
  readonly pointing: Pick<Pointing, 'act' | 'preview' | 'sync' | 'view'>
  readonly capture: { readonly start: (request: unknown, between: Between, measure: ReadonlyArray<Measurement>) => StartResult; readonly labelOf: (file: string) => { readonly run: string; readonly frame: number } | undefined }
  readonly publish: (kind: 'started' | 'pass', body: Readonly<Record<string, unknown>>) => void
  readonly settings: CentreSettings
  readonly now: () => number
}

export interface CentreTarget {
  readonly id: string
  readonly name: string
  readonly raJ2000Hours: number
  readonly decJ2000Degrees: number
}

export type CentrePass =
  | { readonly frame: number; readonly solved: false; readonly reason: string }
  | {
      readonly frame: number
      readonly solved: true
      readonly raDegrees: number
      readonly decDegrees: number
      readonly offsetArcmin: number
      readonly eastArcmin: number
      readonly northArcmin: number
      readonly mountArcmin: number | undefined
    }

export type CentreStep = 'slewing' | 'measuring' | 'syncing'

export interface CentreView {
  readonly run: string | undefined
  readonly startedAt: number | undefined
  readonly target: CentreTarget | undefined
  readonly toleranceArcmin: number
  readonly passes: ReadonlyArray<CentrePass>
  readonly step: { readonly what: CentreStep; readonly since: number } | undefined
  readonly problem: string | undefined
  readonly ended: string | undefined
}

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const arcminutes = (degrees: number) => degrees * 60

const signedDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

export function arcText(arcmin: number) {
  return arcmin < 1 ? `${Math.round(arcmin * 60)}″` : `${arcmin.toFixed(1)}′`
}

export function passOf(solved: EquatorialPosition, target: CentreTarget, mount: EquatorialPosition | undefined, frame: number): CentrePass & { readonly solved: true } {
  const goal = { raDegrees: target.raJ2000Hours * 15, decDegrees: target.decJ2000Degrees }

  return {
    frame,
    solved: true,
    raDegrees: solved.raDegrees,
    decDegrees: solved.decDegrees,
    offsetArcmin: arcminutes(angularDistance(solved, goal)),
    eastArcmin: arcminutes(signedDegrees(solved.raDegrees - goal.raDegrees) * Math.cos((goal.decDegrees * Math.PI) / 180)),
    northArcmin: arcminutes(solved.decDegrees - goal.decDegrees),
    mountArcmin: mount === undefined ? undefined : arcminutes(angularDistance(mount, solved)),
  }
}

function passFrom(body: Readonly<Record<string, unknown>>): CentrePass | undefined {
  const frame = body['frame']

  if (typeof frame !== 'number') return undefined
  if (body['solved'] !== true) return { frame, solved: false, reason: typeof body['reason'] === 'string' ? body['reason'] : 'no solution' }

  const numbers = ['raDegrees', 'decDegrees', 'offsetArcmin', 'eastArcmin', 'northArcmin'].map(key => body[key])

  if (!numbers.every(value => typeof value === 'number')) return undefined

  const [raDegrees, decDegrees, offsetArcmin, eastArcmin, northArcmin] = numbers as number[]
  const mount = body['mountArcmin']

  return { frame, solved: true, raDegrees: raDegrees!, decDegrees: decDegrees!, offsetArcmin: offsetArcmin!, eastArcmin: eastArcmin!, northArcmin: northArcmin!, mountArcmin: typeof mount === 'number' ? mount : undefined }
}

export function makeCentre({ picture, pointing, capture, publish, settings, now }: CentreOptions) {
  const empty: CentreView = { run: undefined, startedAt: undefined, target: undefined, toleranceArcmin: settings.toleranceArcmin, passes: [], step: undefined, problem: undefined, ended: undefined }
  let view = empty
  const listeners = new Set<() => void>()

  function until(check: () => boolean, signal: AbortSignal) {
    return new Promise<boolean>(resolve => {
      const done = (seen: boolean) => {
        listeners.delete(recheck)
        signal.removeEventListener('abort', aborted)
        resolve(seen)
      }
      const recheck = () => {
        if (check()) done(true)
      }
      const aborted = () => done(false)

      if (signal.aborted) return resolve(false)
      if (check()) return resolve(true)

      listeners.add(recheck)
      signal.addEventListener('abort', aborted)
    })
  }

  const stepTo = (what: CentreStep) => {
    view = { ...view, step: { what, since: now() } }
  }

  async function slew(target: CentreTarget, signal: AbortSignal): Promise<string | undefined> {
    stepTo('slewing')

    const sent: PrepareResult = await pointing.act({ action: 'goto', id: target.id })

    if (!sent.ok) return `goto ${target.name}: ${sent.reason}`

    const sentAt = pointing.view().goto?.sentAt
    const settled = () => {
      const goto = pointing.view().goto

      return goto?.sentAt !== sentAt || goto === undefined || goto.phase === 'arrived' || goto.phase === 'failed' || goto.phase === 'stopped'
    }

    if (!(await until(settled, signal))) return undefined

    const goto = pointing.view().goto

    if (goto?.sentAt !== sentAt) return 'another goto replaced the centring goto'
    if (goto?.phase === 'failed') return `goto ${target.name} failed: ${goto.detail ?? 'no reason given'}`
    if (goto?.phase === 'stopped') return `goto ${target.name} was stopped`

    return undefined
  }

  const passAt = (frame: number) => view.passes.find(pass => pass.frame === frame)

  return {
    start(json: unknown): Result {
      let request: typeof Request.Type

      try {
        request = decodeConfig(Request, json)
      } catch (error) {
        return { ok: false, reason: `not a centring request: ${error instanceof Error ? error.message : String(error)}` }
      }

      const previewed = pointing.preview(request.id)

      if (!previewed.ok) return previewed

      const controls = picture.property(settings.camera, 'CCD_CONTROLS')?.values

      if (typeof controls?.['Gain'] !== 'number' || typeof controls['Offset'] !== 'number') return { ok: false, reason: `${settings.camera} has no gain and offset on the stream` }

      const found = previewed.target
      const target: CentreTarget = { id: found.id, name: found.commonName ?? found.name, raJ2000Hours: found.raJ2000Hours, decJ2000Degrees: found.decJ2000Degrees }
      let run = ''

      const between: Between = async (frame, signal) => {
        const waitOn = async (problem: string) => {
          view = { ...view, problem, step: undefined }
          await until(() => false, signal)

          return undefined
        }

        if (frame > 0) {
          if (!(await until(() => view.run === run && passAt(frame) !== undefined, signal))) return undefined

          const pass = passAt(frame)!

          if (!pass.solved) {
            stepTo('measuring')

            return undefined
          }

          if (pass.offsetArcmin <= settings.toleranceArcmin) return { done: `centred on ${target.name}, ${arcText(pass.offsetArcmin)} from it after ${frame} ${frame === 1 ? 'frame' : 'frames'}` }

          stepTo('syncing')

          const ofDate = toMount({ raDegrees: pass.raDegrees, decDegrees: pass.decDegrees }, new Date(now()))
          const synced = await pointing.sync(ofDate.raDegrees / 15, ofDate.decDegrees)

          if (!synced.ok) return waitOn(`sync to the solve of frame ${frame}: ${synced.reason}`)
        }

        const problem = await slew(target, signal)

        if (problem !== undefined) return waitOn(problem)

        stepTo('measuring')

        return undefined
      }

      const started = capture.start({ object: 'centre', frameType: 'light', exposureSeconds: request.exposureSeconds, gain: controls['Gain'], offset: controls['Offset'], cooler: 'keep' }, between, ['solve'])

      if (!started.ok) return started

      run = started.run
      view = { ...empty, run, startedAt: now(), target }
      publish('started', { run, ...target, toleranceArcmin: settings.toleranceArcmin })

      return { ok: true }
    },

    measured(answer: Measured) {
      const label = capture.labelOf(answer.file)
      const target = view.target

      if (label === undefined || label.run !== view.run || target === undefined) return

      const base = { run: label.run, frame: label.frame, file: answer.file }

      if (answer.result === 'refused') return publish('pass', { ...base, solved: false, reason: `the rig program did not measure it: ${answer.reason}` })
      if (answer.solve === undefined) return publish('pass', { ...base, solved: false, reason: 'the rig program sent no solve' })
      if (!answer.solve.solved) return publish('pass', { ...base, solved: false, reason: answer.solve.reason })

      const at = exposureMiddle(Object.entries(answer.header).map(([key, value]) => ({ key, value: String(value), comment: '' }))) ?? now()
      const reading = picture.property(settings.mount, 'EQUATORIAL_EOD_COORD')?.values
      const mount = typeof reading?.['RA'] === 'number' && typeof reading['DEC'] === 'number' ? fromMount({ raDegrees: reading['RA'] * 15, decDegrees: reading['DEC'] }, new Date(at)) : undefined

      publish('pass', { ...base, ...passOf({ raDegrees: answer.solve.raDegrees, decDegrees: answer.solve.decDegrees }, target, mount, label.frame) })
    },

    observe(entry: Entry) {
      const body = recordOf(entry.body) ?? {}

      if (entry.kind === 'vela.centre.started' && body['run'] !== view.run) {
        const numbers = [body['raJ2000Hours'], body['decJ2000Degrees']]
        const target = typeof body['id'] === 'string' && typeof body['name'] === 'string' && numbers.every(value => typeof value === 'number') ? { id: body['id'], name: body['name'], raJ2000Hours: numbers[0] as number, decJ2000Degrees: numbers[1] as number } : undefined

        view = { ...empty, run: String(body['run']), startedAt: entry.at, target }
      } else if (body['run'] === view.run && entry.kind === 'vela.centre.pass') {
        const pass = passFrom(body)

        if (pass !== undefined) view = { ...view, passes: [...view.passes.filter(old => old.frame !== pass.frame), pass].sort((a, b) => a.frame - b.frame) }
      } else if (body['run'] === view.run && entry.kind === 'vela.run.ended') {
        view = { ...view, step: undefined, ended: typeof body['reason'] === 'string' ? body['reason'] : 'ended' }
      }

      for (const listener of [...listeners]) listener()
    },

    view: (): CentreView => view,
  }
}

export type Centre = ReturnType<typeof makeCentre>
