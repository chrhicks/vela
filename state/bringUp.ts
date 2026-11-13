import type { Value } from './entry.ts'
import type { RigState } from './rig.ts'

export const neededReadings: Readonly<Record<string, ReadonlyArray<string>>> = {
  mount: ['GEOGRAPHIC_COORD', 'TIME_UTC', 'EQUATORIAL_EOD_COORD'],
  primary: ['CCD_CONTROLS', 'CCD_TEMPERATURE', 'CCD_COOLER'],
  focuser: ['ABS_FOCUS_POSITION'],
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

function pendingChanges(rig: RigState, device: string): ReadonlyArray<Change> {
  return Object.entries(rig.writes[device] ?? {}).flatMap(([property, write]) => {
    const now = rig.readings[device]?.[property]?.values ?? {}

    return Object.entries(write.values).flatMap(([element, to]) => (now[element] === to ? [] : [{ property, element, from: now[element], to }]))
  })
}

export function deviceBringUp(rig: RigState, device: string): DeviceBringUp {
  const readings = rig.readings[device]

  if (readings?.['CONNECTION']?.values['CONNECT'] !== true) return { status: 'waiting', changes: [] }

  const pending = Object.keys(rig.writes[device] ?? {}).length > 0
  const missing = (neededReadings[device] ?? []).some(property => readings[property] === undefined)

  return pending || missing ? { status: 'setting', changes: pendingChanges(rig, device) } : { status: 'set', changes: [] }
}

export const rigProgramHeard = (rig: RigState) => rig.heardAt !== undefined

export const guiderHeard = (rig: RigState) => rig.guiding.link === 'connected'
