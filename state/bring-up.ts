import type { DeviceName, Devices } from './devices.ts'
import type { Value } from './entry.ts'
import type { RigState } from './rig.ts'

export const neededReadings: { readonly [Name in DeviceName]: ReadonlyArray<keyof Devices[Name]> } = {
  mount: ['GEOGRAPHIC_COORD', 'TIME_UTC', 'EQUATORIAL_EOD_COORD'],
  primary: ['CCD_CONTROLS', 'CCD_TEMPERATURE', 'CCD_COOLER'],
  focuser: ['ABS_FOCUS_POSITION'],
  box: [],
  guide: [],
}

export type BringUpStatus = 'waiting' | 'setting' | 'set'

export interface Change {
  readonly property: string
  readonly element: string
  readonly from: Value | undefined
  readonly to: Value
}

export interface DeviceBringUp {
  readonly status: BringUpStatus
  readonly changes: ReadonlyArray<Change>
}

function pendingChanges(rig: RigState, device: DeviceName): ReadonlyArray<Change> {
  return Object.entries(rig.writes[device] ?? {}).flatMap(([property, write]) => {
    const now = rig.readings[device]?.[property]?.values ?? {}

    return Object.entries(write.values).flatMap(([element, to]) => (now[element] === to ? [] : [{ property, element, from: now[element], to }]))
  })
}

export function deviceBringUp<Name extends DeviceName>(rig: RigState, device: Name): DeviceBringUp {
  const reported: Devices[Name] = rig.devices[device]

  if (reported.CONNECTION?.values.CONNECT !== true) return { status: 'waiting', changes: [] }

  const pending = Object.keys(rig.writes[device] ?? {}).length > 0
  const needed: ReadonlyArray<keyof Devices[Name]> = neededReadings[device]
  const missing = needed.some(property => reported[property] === undefined)

  return pending || missing ? { status: 'setting', changes: pendingChanges(rig, device) } : { status: 'set', changes: [] }
}

export const rigProgramUp = (rig: Pick<RigState, 'heardAt'>, serviceNow: number | undefined, silentAfterSeconds: number | undefined) =>
  rig.heardAt !== undefined && serviceNow !== undefined && silentAfterSeconds !== undefined && serviceNow - rig.heardAt <= silentAfterSeconds * 1000

export const guiderHeard = (rig: RigState) => rig.guiding.link === 'connected'
