import { SiderealTime } from 'astronomy-engine'
import { Schema } from 'effect'
import type { Between, StartResult } from '../capture/run.ts'
import type { Sender } from '../commands/sender.ts'
import { decodeConfig } from '../config.ts'
import type { Card } from '../frames/fits.ts'
import type { Measured, Measurement } from '../measure/rig.ts'
import { siteOf, type Site } from '../pointing/target.ts'
import type { Picture } from '../rig/picture.ts'
import type { Entry } from '../../state/entry.ts'
import { readWireBody, recordOf } from '../stream/json.ts'
import { errorNow, polarError, poleOf, referenceFrom, type PolarError, type Reference, type Solve } from './polar.ts'
import { operationObjects } from '../../state/entries.ts'

const Request = Schema.Struct({ exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)) })

export interface AlignSettings {
  readonly mount: string
  readonly camera: string
  readonly declinationDegrees: number
  readonly hourAnglesDegrees: readonly [number, number, number]
}

export interface AlignOptions {
  readonly picture: Pick<Picture, 'property'>
  readonly sender: Pick<Sender, 'send'>
  readonly capture: { readonly start: (request: unknown, between: Between, measure: ReadonlyArray<Measurement>) => StartResult; readonly labelOf: (file: string) => { readonly run: string; readonly frame: number } | undefined }
  readonly publish: (kind: 'started' | 'solve', body: Readonly<Record<string, unknown>>) => void
  readonly settings: AlignSettings
  readonly now: () => number
}

export interface AlignView {
  readonly run: string | undefined
  readonly startedAt: number | undefined
  readonly frames: ReadonlyArray<{ readonly frame: number; readonly solved: boolean; readonly reason: string | undefined }>
  readonly first: PolarError | undefined
  readonly error: (PolarError & { readonly at: number; readonly frame: number }) | undefined
  readonly previous: (PolarError & { readonly at: number; readonly frame: number }) | undefined
  readonly ended: string | undefined
  readonly lastFrameAt: number | undefined
  readonly problem: string | undefined
}

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const empty: AlignView = { run: undefined, startedAt: undefined, frames: [], first: undefined, error: undefined, previous: undefined, ended: undefined, lastFrameAt: undefined, problem: undefined }

export function exposureMiddle(cards: ReadonlyArray<Card>): number | undefined {
  const start = cards.find(card => card.key === 'DATE-OBS')?.value
  const seconds = Number(cards.find(card => card.key === 'EXPTIME')?.value)
  const at = start === undefined ? Number.NaN : Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(start) ? start : `${start}Z`)

  return Number.isFinite(at) && Number.isFinite(seconds) ? at + (seconds * 1000) / 2 : undefined
}

export function raForHourAngle(hourAngleDegrees: number, site: Site, at: number) {
  const localSiderealDegrees = SiderealTime(new Date(at)) * 15 + site.longitudeDegrees

  return ((((localSiderealDegrees - hourAngleDegrees) % 360) + 360) % 360) / 15
}

export function makeAlign({ picture, sender, capture, publish, settings, now }: AlignOptions) {
  let view = empty
  let site: Site | undefined
  let solves = new Map<number, Solve>()
  let reference: Reference | undefined
  let slew: { phase: 'sent' | 'moving' | 'arrived' | 'alert' } | undefined
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

  async function slewTo(hourAngle: number, signal: AbortSignal): Promise<string | undefined> {
    const onCoordSet = picture.property(settings.mount, 'ON_COORD_SET')

    if (site === undefined) return 'the mount gives no site'
    if (onCoordSet === undefined || !('TRACK' in onCoordSet.values)) return `${settings.mount} has no TRACK element in ON_COORD_SET`

    const mode = await sender.send({ device: settings.mount, property: 'ON_COORD_SET', values: Object.fromEntries(Object.keys(onCoordSet.values).map(element => [element, element === 'TRACK'])) }, signal)

    if (mode.result !== 'written') return `ON_COORD_SET: ${mode.reason}`

    slew = { phase: 'sent' }

    const target = { RA: raForHourAngle(hourAngle, site, now()), DEC: settings.declinationDegrees }
    const sent = await sender.send({ device: settings.mount, property: 'EQUATORIAL_EOD_COORD', values: target }, signal)

    if (sent.result !== 'written') return `slew to hour angle ${hourAngle}°: ${sent.reason}`

    const current = slew

    await until(() => current.phase === 'arrived' || current.phase === 'alert', signal)

    return current.phase === 'alert' ? `the mount answered the slew to hour angle ${hourAngle}° with an alert` : undefined
  }

  const solvedOf = (frame: number) => view.frames.find(candidate => candidate.frame === frame)

  return {
    start(json: unknown): Result {
      let request: typeof Request.Type

      try {
        request = decodeConfig(Request, json)
      } catch (error) {
        return { ok: false, reason: `not a polar alignment request: ${error instanceof Error ? error.message : String(error)}` }
      }

      const controls = picture.property(settings.camera, 'CCD_CONTROLS')?.values

      site = siteOf(picture, settings.mount)

      if (site === undefined) return { ok: false, reason: `${settings.mount} gives no site (GEOGRAPHIC_COORD) on the stream` }
      if (typeof controls?.['Gain'] !== 'number' || typeof controls['Offset'] !== 'number') return { ok: false, reason: `${settings.camera} has no gain and offset on the stream` }

      let run = ''

      const between: Between = async (frame, signal) => {
        if (frame > 0) {
          const measured = await until(() => view.run === run && solvedOf(frame) !== undefined, signal)

          if (!measured) return undefined

          const last = solvedOf(frame)

          if (last?.solved === false && frame <= settings.hourAnglesDegrees.length) return `frame ${frame} did not solve: ${last.reason}`
        }

        const hourAngle = settings.hourAnglesDegrees[frame]

        const problem = hourAngle === undefined ? undefined : await slewTo(hourAngle, signal)

        if (problem !== undefined) {
          view = { ...view, problem }
          await until(() => false, signal)
        }

        return undefined
      }

      const started = capture.start({ object: operationObjects.align, frameType: 'light', exposureSeconds: request.exposureSeconds, gain: controls['Gain'], offset: controls['Offset'], cooler: 'keep' }, between, ['solve'])

      if (!started.ok) return started

      run = started.run
      solves = new Map()
      reference = undefined
      publish('started', { run, declinationDegrees: settings.declinationDegrees, hourAnglesDegrees: settings.hourAnglesDegrees })

      return { ok: true }
    },

    measured(answer: Measured) {
      const label = capture.labelOf(answer.file)

      if (label === undefined || label.run !== view.run || site === undefined) return

      const base = { run: label.run, frame: label.frame, file: answer.file }

      if (answer.result === 'refused') return publish('solve', { ...base, solved: false, reason: `the rig program did not measure it: ${answer.reason}` })
      if (answer.solve === undefined) return publish('solve', { ...base, solved: false, reason: 'the rig program sent no solve' })
      if (!answer.solve.solved) return publish('solve', { ...base, solved: false, reason: answer.solve.reason })

      const at = exposureMiddle(Object.entries(answer.header).map(([key, value]) => ({ key, value: String(value), comment: '' })))

      if (at === undefined) return publish('solve', { ...base, solved: false, reason: 'the frame has no DATE-OBS or EXPTIME' })

      const solved: Solve = { raDegrees: answer.solve.raDegrees, decDegrees: answer.solve.decDegrees, at }
      const measured = { ...base, solved: true, raDegrees: solved.raDegrees, decDegrees: solved.decDegrees, at }

      solves.set(label.frame, solved)

      const [first, second, third] = [solves.get(1), solves.get(2), solves.get(3)]

      if (reference === undefined && first !== undefined && second !== undefined && third !== undefined) reference = referenceFrom([first, second, third], site)
      if (reference === undefined || label.frame < 3) return publish('solve', measured)

      const error = label.frame === 3 ? polarError(reference.axis, poleOf(at, site)) : errorNow(reference, solved, site, true)

      publish('solve', { ...measured, ...error })
    },

    observe(entry: Entry) {
      const body = recordOf(entry.body) ?? {}

      if (entry.kind === 'vela.align.started') {
        view = { ...empty, run: String(body['run']), startedAt: entry.at }
      } else if (body['run'] === view.run && entry.kind === 'vela.align.solve') {
        const frame = Number(body['frame'])
        const frames = [...view.frames.filter(old => old.frame !== frame), { frame, solved: body['solved'] === true, reason: typeof body['reason'] === 'string' ? body['reason'] : undefined }]
        const altitude = body['altitudeArcmin']
        const error = typeof altitude === 'number' ? { altitudeArcmin: altitude, azimuthArcmin: Number(body['azimuthArcmin']), totalArcmin: Number(body['totalArcmin']), at: Number(body['at']), frame } : undefined

        const newer = error !== undefined && (view.error === undefined || frame > view.error.frame)

        view = { ...view, lastFrameAt: entry.at, frames, first: frame === 3 && error !== undefined ? error : view.first, error: newer ? error : view.error, previous: newer ? view.error : view.previous }
      } else if (body['run'] === view.run && entry.kind === 'vela.run.ended') {
        view = { ...view, ended: typeof body['reason'] === 'string' ? body['reason'] : 'ended' }
      } else if (slew !== undefined && entry.kind === 'wire') {
        const wire = readWireBody(entry)

        if (wire?.dir === 'in' && wire.device === settings.mount && wire.property === 'EQUATORIAL_EOD_COORD') {
          if (wire.state === 'Alert') slew.phase = 'alert'
          else if (wire.state === 'Busy') slew.phase = 'moving'
          else if ((wire.state === 'Ok' || wire.state === 'Idle') && slew.phase === 'moving') slew.phase = 'arrived'
        }
      }

      for (const listener of [...listeners]) listener()
    },

    view: (): AlignView => view,
  }
}

export type Align = ReturnType<typeof makeAlign>
