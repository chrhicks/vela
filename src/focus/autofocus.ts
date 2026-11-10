import { Schema } from 'effect'
import type { Between, StartResult } from '../capture/run.ts'
import type { Sender } from '../commands/sender.ts'
import { decodeConfig } from '../config.ts'
import type { Measured, Measurement } from '../measure/rig.ts'
import type { Picture } from '../rig/picture.ts'
import { recordOf, type Entry } from '../stream/entry.ts'

export const focusSubject = 'rig-dev.vela.focus'

const positive = Schema.Int.check(Schema.isGreaterThan(0))

const Request = Schema.Struct({
  step: positive,
  samples: Schema.Int.check(Schema.isGreaterThanOrEqualTo(3)),
  exposureSeconds: Schema.Finite.check(Schema.isGreaterThan(0)),
})

export interface Sample {
  readonly frame: number
  readonly position: number
  readonly hfd: number | undefined
  readonly stars: number
  readonly missed?: string
}

export interface Best {
  readonly position: number
  readonly how: 'fit' | 'lowest' | 'edge'
}

export interface AutofocusView {
  readonly run: string | undefined
  readonly startedAt: number | undefined
  readonly positions: ReadonlyArray<number>
  readonly samples: ReadonlyArray<Sample>
  readonly best: Best | undefined
  readonly check: Sample | undefined
  readonly ended: string | undefined
  readonly problem: string | undefined
}

export function bestFocus(samples: ReadonlyArray<Sample>, minStars: number): Best | undefined {
  const most = Math.max(0, ...samples.map(sample => sample.stars))

  if (most < minStars) return undefined

  const byPosition = [...samples].sort((a, b) => a.position - b.position)
  const usable = byPosition.filter(sample => sample.hfd !== undefined && sample.stars >= most / 2)
  const lowest = usable.reduce((best, sample) => (sample.hfd! < best.hfd! ? sample : best))
  const at = usable.indexOf(lowest)
  const below = usable[at - 1]
  const above = usable[at + 1]

  if (lowest === byPosition[0] || lowest === byPosition[byPosition.length - 1]) return { position: lowest.position, how: 'edge' }
  if (below === undefined || above === undefined || below.position + above.position !== 2 * lowest.position) return { position: lowest.position, how: 'lowest' }

  const step = lowest.position - below.position
  const curve = below.hfd! - 2 * lowest.hfd! + above.hfd!
  const vertex = curve <= 0 ? lowest.position : lowest.position + (step * (below.hfd! - above.hfd!)) / (2 * curve)

  return { position: Math.round(Math.max(below.position, Math.min(above.position, vertex))), how: 'fit' }
}

export interface AutofocusSettings {
  readonly focuser: string
  readonly camera: string
  readonly minStars: number
}

export interface AutofocusOptions {
  readonly picture: Pick<Picture, 'property'>
  readonly sender: Pick<Sender, 'send'>
  readonly capture: { readonly start: (request: unknown, between: Between, measure: ReadonlyArray<Measurement>) => StartResult; readonly labelOf: (file: string) => { readonly run: string; readonly frame: number } | undefined }
  readonly publish: (kind: 'started' | 'sample' | 'best', body: Readonly<Record<string, unknown>>) => void
  readonly settings: AutofocusSettings
}

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string }

const empty: AutofocusView = { run: undefined, startedAt: undefined, positions: [], samples: [], best: undefined, check: undefined, ended: undefined, problem: undefined }

export function makeAutofocus({ picture, sender, capture, publish, settings }: AutofocusOptions) {
  let view = empty
  const listeners = new Set<() => void>()

  const changed = () => {
    for (const listener of [...listeners]) listener()
  }

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

  async function move(position: number, signal: AbortSignal): Promise<string | undefined> {
    const outcome = await sender.send({ device: settings.focuser, property: 'ABS_FOCUS_POSITION', values: { FOCUS_ABSOLUTE_POSITION: position } }, signal)

    if (outcome.result !== 'written') return `focuser move to ${position}: ${outcome.reason}`

    await until(() => {
      const absolute = picture.property(settings.focuser, 'ABS_FOCUS_POSITION')

      return absolute?.state === 'Ok' && absolute.values['FOCUS_ABSOLUTE_POSITION'] === position
    }, signal)

    return undefined
  }

  return {
    start(json: unknown): Result {
      let request: typeof Request.Type

      try {
        request = decodeConfig(Request, json)
      } catch (error) {
        return { ok: false, reason: `not an autofocus request: ${error instanceof Error ? error.message : String(error)}` }
      }

      const absolute = picture.property(settings.focuser, 'ABS_FOCUS_POSITION')
      const current = absolute?.values['FOCUS_ABSOLUTE_POSITION']
      const controls = picture.property(settings.camera, 'CCD_CONTROLS')?.values

      if (typeof current !== 'number') return { ok: false, reason: `${settings.focuser} has no position on the stream` }
      if (typeof controls?.['Gain'] !== 'number' || typeof controls['Offset'] !== 'number') return { ok: false, reason: `${settings.camera} has no gain and offset on the stream` }

      const top = current + request.step * Math.floor(request.samples / 2)
      const positions = Array.from({ length: request.samples }, (_, index) => top - index * request.step)
      const limits = absolute?.limits['FOCUS_ABSOLUTE_POSITION']
      const outside = limits !== undefined && (top + request.step > limits.max || positions[positions.length - 1]! < limits.min)

      if (outside) return { ok: false, reason: `the sweep ${positions[positions.length - 1]} to ${top + request.step} leaves the focuser's travel, ${limits.min} to ${limits.max}` }

      let run = ''

      const between: Between = async (frame, signal) => {
        const waitOn = async (problem: string | undefined) => {
          if (problem === undefined) return undefined

          view = { ...view, problem }
          changed()
          await until(() => false, signal)

          return undefined
        }

        if (frame === 0) return waitOn((await move(top + request.step, signal)) ?? (await move(top, signal)))
        if (frame < positions.length) return waitOn(await move(positions[frame]!, signal))

        const measured = await until(() => view.run === run && view.samples.length >= positions.length, signal)

        if (!measured) return undefined

        const best = bestFocus(view.samples, settings.minStars)

        if (best === undefined) {
          const back = (await move(top + request.step, signal)) ?? (await move(current, signal))

          return `no frame of the sweep showed ${settings.minStars} stars; ${back ?? `the focuser is back at ${current}`}`
        }

        publish('best', { run, ...best })

        return waitOn((await move(top + request.step, signal)) ?? (await move(best.position, signal)))
      }

      const started = capture.start({ object: 'autofocus', frameType: 'light', exposureSeconds: request.exposureSeconds, count: request.samples + 1, gain: controls['Gain'], offset: controls['Offset'], cooler: 'keep' }, between, ['stars'])

      if (!started.ok) return started

      run = started.run
      publish('started', { run, positions, step: request.step, exposureSeconds: request.exposureSeconds })

      return { ok: true }
    },

    measured(answer: Measured) {
      const label = capture.labelOf(answer.file)
      const position = label === undefined || label.run !== view.run ? undefined : (view.positions[label.frame - 1] ?? view.best?.position)

      if (label === undefined || position === undefined) return

      const base = { run: label.run, frame: label.frame, position }

      if (answer.result === 'refused') return publish('sample', { ...base, hfd: null, stars: 0, missed: `the rig program did not measure it: ${answer.reason}` })

      const stars = answer.stars?.measured === true ? answer.stars : undefined

      publish('sample', { ...base, hfd: stars !== undefined && stars.count > 0 ? stars.hfd : null, stars: stars?.count ?? 0 })
    },

    observe(entry: Entry) {
      const body = recordOf(entry.body) ?? {}

      if (entry.kind === 'vela.focus.started') {
        view = { ...empty, run: String(body['run']), startedAt: entry.at, positions: Array.isArray(body['positions']) ? body['positions'].filter(value => typeof value === 'number') : [] }
      } else if (body['run'] === view.run && entry.kind === 'vela.focus.sample') {
        const sample: Sample = { frame: Number(body['frame']), position: Number(body['position']), hfd: typeof body['hfd'] === 'number' ? body['hfd'] : undefined, stars: Number(body['stars']), ...(typeof body['missed'] === 'string' ? { missed: body['missed'] } : {}) }

        view = sample.frame > view.positions.length ? { ...view, check: sample } : { ...view, samples: [...view.samples.filter(old => old.frame !== sample.frame), sample] }
      } else if (body['run'] === view.run && entry.kind === 'vela.focus.best') {
        view = { ...view, best: { position: Number(body['position']), how: body['how'] === 'fit' || body['how'] === 'edge' ? body['how'] : 'lowest' } }
      } else if (body['run'] === view.run && entry.kind === 'vela.run.ended') {
        view = { ...view, ended: typeof body['reason'] === 'string' ? body['reason'] : 'ended' }
      }

      changed()
    },

    view: (): AutofocusView => view,
  }
}

export type Autofocus = ReturnType<typeof makeAutofocus>
