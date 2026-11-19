import type { Sender } from '../commands/sender.ts'
import type { Picture } from '../rig/picture.ts'
import type { EquatorialOfDate } from '../sky/horizontal.ts'
import type { Entry } from '../../state/entry.ts'
import { readWireBody } from '../stream/json.ts'

export interface GotoOptions {
  readonly picture: Pick<Picture, 'property'>
  readonly sender: Pick<Sender, 'send'>
  readonly mount: string
}

export type GotoResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: 'tracking-mode' | 'coordinates' | 'alert' | 'aborted'; readonly reason: string }

type Phase = 'sent' | 'moving' | 'arrived' | 'alert'

export function makeGoto({ picture, sender, mount }: GotoOptions) {
  let slew: { phase: Phase } | undefined
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

  return {
    async to(target: EquatorialOfDate, signal: AbortSignal): Promise<GotoResult> {
      const onCoordSet = picture.property(mount, 'ON_COORD_SET')

      if (onCoordSet === undefined || !('TRACK' in onCoordSet.values)) return { ok: false, refusal: 'tracking-mode', reason: `${mount} has no TRACK element in ON_COORD_SET` }

      const mode = await sender.send({ device: mount, property: 'ON_COORD_SET', values: Object.fromEntries(Object.keys(onCoordSet.values).map(element => [element, element === 'TRACK'])) }, signal)

      if (mode.result !== 'written') return { ok: false, refusal: 'tracking-mode', reason: `ON_COORD_SET: ${mode.reason}` }

      const current: { phase: Phase } = { phase: 'sent' }

      slew = current

      const sent = await sender.send({ device: mount, property: 'EQUATORIAL_EOD_COORD', values: { RA: target.raHours, DEC: target.decDegrees } }, signal)

      if (sent.result !== 'written') return { ok: false, refusal: 'coordinates', reason: sent.reason }

      const settled = await until(() => current.phase === 'arrived' || current.phase === 'alert', signal)

      if (current.phase === 'alert') return { ok: false, refusal: 'alert', reason: 'the mount answered with an alert' }

      return settled ? { ok: true } : { ok: false, refusal: 'aborted', reason: 'the wait for the mount was ended' }
    },

    observe(entry: Entry) {
      if (slew !== undefined && entry.kind === 'wire') {
        const wire = readWireBody(entry)

        if (wire?.dir === 'in' && wire.device === mount && wire.property === 'EQUATORIAL_EOD_COORD') {
          if (wire.state === 'Alert') slew.phase = 'alert'
          else if (wire.state === 'Busy') slew.phase = 'moving'
          else if ((wire.state === 'Ok' || wire.state === 'Idle') && slew.phase === 'moving') slew.phase = 'arrived'
        }
      }

      for (const listener of [...listeners]) listener()
    },
  }
}

export type Goto = ReturnType<typeof makeGoto>
