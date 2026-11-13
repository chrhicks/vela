import { deviceBringUp, guiderHeard, rigProgramUp, type Change as PendingChange } from '../../../../state/bring-up.ts'
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
