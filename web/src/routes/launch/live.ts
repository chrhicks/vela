import { deviceBringUp, guiderHeard, rigProgramUp, type Change as PendingChange } from '../../../../state/bring-up.ts'
import { checkOf } from '../../../../state/autofocus.ts'
import type { FilterAnswer } from '../../../../state/commands.ts'
import type { Value } from '../../../../state/entry.ts'
import type { RigState } from '../../../../state/rig.ts'
import type { Change, Device } from './stub.ts'

const devices: ReadonlyArray<readonly [name: string, id: string]> = [
  ['Mount', 'mount'],
  ['Focuser', 'focuser'],
  ['Power box', 'box'],
  ['Camera', 'primary'],
  ['Guide cam', 'guide'],
]

const shown = (value: Value | undefined) => (value === undefined ? '—' : typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value))

const worded = ({ element, from, to }: PendingChange): Change => ({ property: element.replaceAll('_', ' '), from: shown(from), to: shown(to) })

export function liveBringUp(rig: RigState, rigUp: boolean): ReadonlyArray<Device> {
  return [
    { name: 'Rig PC', state: rigUp ? 'up' : 'waiting', changes: [] },
    ...devices.map(([name, id]) => {
      const { status, changes } = deviceBringUp(rig, id)

      return { name, state: status, changes: changes.map(worded) }
    }),
    { name: 'PHD2', state: guiderHeard(rig) ? 'set' : 'waiting', changes: [] },
  ]
}

export interface Ready {
  readonly checklist: { readonly done: number; readonly of: number }
  readonly devices: { readonly set: number; readonly of: number }
  readonly alignArcmin: number | undefined
  readonly alignGood: boolean
  readonly filter: FilterAnswer | undefined
  readonly focusPixels: number | undefined
  readonly focusFound: boolean
  readonly focusedAt: number | undefined
  readonly allGood: boolean
}

export function liveReady(rig: RigState, rigUp: boolean, checklist: { readonly done: number; readonly of: number }, goodArcmin: number | undefined): Ready {
  const states = liveBringUp(rig, rigUp).map(device => device.state)
  const devices = { set: states.filter(state => state === 'set' || state === 'up').length, of: states.length }
  const alignArcmin = rig.alignment.errors.at(-1)?.totalArcmin
  const alignGood = alignArcmin !== undefined && goodArcmin !== undefined && alignArcmin < goodArcmin
  const focus = rig.operations.focus
  const focusFound = focus?.status === 'ended' && focus.ending === 'done' && focus.run === rig.autofocus.run && rig.autofocus.best !== undefined
  const focusPixels = checkOf(rig.autofocus)?.hfd ?? undefined
  const filter = rig.operations.filter

  return {
    checklist,
    devices,
    alignArcmin,
    alignGood,
    filter,
    focusPixels,
    focusFound,
    focusedAt: focus?.status === 'ended' ? focus.endedAt : undefined,
    allGood: checklist.done === checklist.of && devices.set === devices.of && alignGood && filter !== undefined && focusFound,
  }
}
