import { Schema } from 'effect'
import { findRow, searchCatalog, type TargetSummary } from '../catalog/search.ts'
import type { Sender } from '../commands/sender.ts'
import { decodeConfig } from '../config.ts'
import type { PrepareResult } from '../prepare/prepare.ts'
import type { Picture } from '../rig/picture.ts'
import { angularDistance } from '../sky/coordinates.ts'
import type { Entry } from '../../state/entry.ts'
import { readWireBody } from '../stream/json.ts'
import { meridianLimitAt, targetOf, type Target } from './target.ts'

const Request = Schema.Union([
  Schema.Struct({ action: Schema.Literal('goto'), id: Schema.String }),
  Schema.Struct({ action: Schema.Literal('unpark') }),
  Schema.Struct({ action: Schema.Literal('home') }),
  Schema.Struct({ action: Schema.Literal('tracking'), on: Schema.Boolean }),
  Schema.Struct({ action: Schema.Literal('stop') }),
])

export interface PointingSettings {
  readonly mount: string
  readonly searchResults: number
}

export interface PointingOptions {
  readonly picture: Pick<Picture, 'property' | 'rig'>
  readonly sender: Pick<Sender, 'send'>
  readonly settings: PointingSettings
  readonly now: () => number
}

export type GotoPhase = 'sending' | 'sent' | 'slewing' | 'arrived' | 'failed' | 'stopped'

export interface GotoView {
  readonly id: string
  readonly name: string
  readonly raHours: number
  readonly decDegrees: number
  readonly sentAt: number
  readonly phase: GotoPhase
  readonly detail: string | undefined
  readonly arrivedAt: number | undefined
  readonly separationDegrees: number | undefined
}

export interface PointingView {
  readonly at: number
  readonly parked: boolean | undefined
  readonly tracking: boolean | undefined
  readonly goto: GotoView | undefined
}

export type Preview =
  | { readonly ok: true; readonly target: Target; readonly meridianLimitAt: number | undefined }
  | { readonly ok: false; readonly reason: string }

interface Pending {
  readonly target: Target
  readonly sentAt: number
  phase: GotoPhase
  detail: string | undefined
  arrivedAt: number | undefined
  armed: boolean
}

const refuse = (reason: string): PrepareResult => ({ ok: false, reason })

export function makePointing({ picture, sender, settings, now }: PointingOptions) {
  const { mount } = settings
  let pending: Pending | undefined

  const read = (property: string) => picture.property(mount, property)

  async function write(property: string, values: Readonly<Record<string, number | boolean>>): Promise<PrepareResult> {
    const outcome = await sender.send({ device: mount, property, values })

    return outcome.result === 'written' ? { ok: true } : refuse(`${property}: ${outcome.reason}`)
  }

  function mountProblem(property: string): string | undefined {
    if (read('CONNECTION')?.values['CONNECT'] !== true) return `${mount} is not connected`
    if (read(property) === undefined) return `${mount} has no ${property} on the stream`

    return undefined
  }

  function preview(id: string): Preview {
    const row = findRow(id)

    if (row === undefined) return { ok: false, reason: `no catalog target ${id}` }

    const at = now()
    const target = targetOf(row, at)

    return { ok: true, target, meridianLimitAt: meridianLimitAt(picture, mount, target.raHours, at) }
  }

  async function goto(id: string): Promise<PrepareResult> {
    const problem = mountProblem('EQUATORIAL_EOD_COORD') ?? mountProblem('ON_COORD_SET')

    if (problem !== undefined) return refuse(problem)
    if (read('TELESCOPE_PARK')?.values['PARK'] === true) return refuse(`${mount} is parked: Unpark first`)

    const onCoordSet = read('ON_COORD_SET')

    if (onCoordSet === undefined || !('TRACK' in onCoordSet.values)) return refuse(`${mount} has no TRACK element in ON_COORD_SET`)

    const previewed = preview(id)

    if (!previewed.ok) return refuse(previewed.reason)

    const started: Pending = { target: previewed.target, sentAt: now(), phase: 'sending', detail: undefined, arrivedAt: undefined, armed: false }

    pending = started

    function failed(result: PrepareResult & { ok: false }) {
      if (pending === started) {
        started.phase = 'failed'
        started.detail = result.reason
      }

      return result
    }

    const mode = await write('ON_COORD_SET', Object.fromEntries(Object.keys(onCoordSet.values).map(element => [element, element === 'TRACK'])))

    if (!mode.ok) return failed(mode)

    started.armed = true

    const sent = await write('EQUATORIAL_EOD_COORD', { RA: started.target.raHours, DEC: started.target.decDegrees })

    if (!sent.ok) return failed(sent)

    if (pending === started && started.phase === 'sending') started.phase = 'sent'

    return sent
  }

  async function sync(raHours: number, decDegrees: number): Promise<PrepareResult> {
    const problem = mountProblem('EQUATORIAL_EOD_COORD') ?? mountProblem('ON_COORD_SET')

    if (problem !== undefined) return refuse(problem)

    const elements = Object.keys(read('ON_COORD_SET')?.values ?? {})

    if (!elements.includes('SYNC') || !elements.includes('TRACK')) return refuse(`${mount} has no SYNC and TRACK elements in ON_COORD_SET`)

    const mode = (element: string) => Object.fromEntries(elements.map(name => [name, name === element]))
    const syncing = await write('ON_COORD_SET', mode('SYNC'))

    if (!syncing.ok) return syncing

    const synced = await write('EQUATORIAL_EOD_COORD', { RA: raHours, DEC: decDegrees })
    const tracking = await write('ON_COORD_SET', mode('TRACK'))

    return synced.ok ? tracking : synced
  }

  async function unpark(): Promise<PrepareResult> {
    const park = read('TELESCOPE_PARK')

    if (park === undefined || !('UNPARK' in park.values)) return refuse(`${mount} has no UNPARK on the stream`)

    return write('TELESCOPE_PARK', { UNPARK: true })
  }

  async function home(): Promise<PrepareResult> {
    const problem = mountProblem('TELESCOPE_HOME')

    if (problem !== undefined) return refuse(problem)

    return write('TELESCOPE_HOME', { GO: true })
  }

  async function tracking(on: boolean): Promise<PrepareResult> {
    const state = read('TELESCOPE_TRACK_STATE')

    if (state === undefined) return refuse(`${mount} has no TELESCOPE_TRACK_STATE on the stream`)

    return write('TELESCOPE_TRACK_STATE', { TRACK_ON: on, TRACK_OFF: !on })
  }

  async function stop(): Promise<PrepareResult> {
    const result = await write('TELESCOPE_ABORT_MOTION', { ABORT: true })

    if (pending !== undefined && (pending.phase === 'sending' || pending.phase === 'sent' || pending.phase === 'slewing')) {
      pending.phase = 'stopped'
      pending.detail = result.ok ? 'Stop pressed, abort written' : `Stop pressed, abort not written: ${result.reason}`
    }

    return result
  }

  return {
    search: (text: string): ReadonlyArray<TargetSummary> => searchCatalog(text, settings.searchResults),

    preview,

    sync,

    async act(json: unknown): Promise<PrepareResult> {
      let request: typeof Request.Type

      try {
        request = decodeConfig(Request, json)
      } catch (error) {
        return refuse(`not a pointing request: ${error instanceof Error ? error.message : String(error)}`)
      }

      switch (request.action) {
        case 'goto':
          return goto(request.id)
        case 'unpark':
          return unpark()
        case 'home':
          return home()
        case 'tracking':
          return tracking(request.on)
        case 'stop':
          return stop()
      }
    },

    observe(entry: Entry) {
      if (pending === undefined || !pending.armed || entry.kind !== 'wire') return

      const wire = readWireBody(entry)

      if (wire === undefined || wire.dir !== 'in' || wire.device !== mount || wire.property !== 'EQUATORIAL_EOD_COORD' || wire.state === undefined) return

      if (wire.state === 'Alert' && (pending.phase === 'sending' || pending.phase === 'sent' || pending.phase === 'slewing')) {
        pending.phase = 'failed'
        pending.detail = 'the mount answered the slew with an alert'
      } else if (wire.state === 'Busy' && (pending.phase === 'sending' || pending.phase === 'sent')) pending.phase = 'slewing'
      else if ((wire.state === 'Ok' || wire.state === 'Idle') && pending.phase === 'slewing') {
        pending.phase = 'arrived'
        pending.arrivedAt = now()
      }
    },

    view(): PointingView {
      const coordinates = read('EQUATORIAL_EOD_COORD')?.values
      const ra = coordinates?.['RA']
      const dec = coordinates?.['DEC']
      const parked = read('TELESCOPE_PARK')?.values['PARK']
      const tracking = read('TELESCOPE_TRACK_STATE')?.values['TRACK_ON']

      return {
        at: now(),
        parked: typeof parked === 'boolean' ? parked : undefined,
        tracking: typeof tracking === 'boolean' ? tracking : undefined,
        goto:
          pending === undefined
            ? undefined
            : {
                id: pending.target.id,
                name: pending.target.commonName ?? pending.target.name,
                raHours: pending.target.raHours,
                decDegrees: pending.target.decDegrees,
                sentAt: pending.sentAt,
                phase: pending.phase,
                detail: pending.detail,
                arrivedAt: pending.arrivedAt,
                separationDegrees:
                  typeof ra === 'number' && typeof dec === 'number'
                    ? angularDistance({ raDegrees: ra * 15, decDegrees: dec }, { raDegrees: pending.target.raHours * 15, decDegrees: pending.target.decDegrees })
                    : undefined,
              },
      }
    },
  }
}

export type Pointing = ReturnType<typeof makePointing>
