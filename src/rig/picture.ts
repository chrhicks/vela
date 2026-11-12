import type { Entry, Limits, Value } from '../../state/entry.ts'
import { readWireBody, recordOf } from '../stream/json.ts'

export interface Property {
  readonly state: string | undefined
  readonly values: Readonly<Record<string, Value>>
  readonly limits: Readonly<Record<string, Limits>>
  readonly changedAt: number
  readonly confirmedAt: number
}

export interface Written {
  readonly values: Readonly<Record<string, Value>>
  readonly at: number
}

export interface RigConnection {
  readonly at: number
  readonly run: string | undefined
  readonly connection: number | undefined
  readonly version: string | undefined
}

export type Phd2Link = 'unknown' | 'connected' | 'closed' | 'failed'

export interface Phd2 {
  readonly link: Phd2Link
  readonly state: string | undefined
  readonly changedAt: number | undefined
  readonly lastStepAt: number | undefined
}

export type IndiLink = 'unknown' | 'connected' | 'closed'

const phd2StateOfEvent: Readonly<Record<string, string>> = {
  GuidingStopped: 'Stopped',
  LoopingExposuresStopped: 'Stopped',
  LoopingExposures: 'Looping',
  StartCalibration: 'Calibrating',
  StartGuiding: 'Guiding',
  GuideStep: 'Guiding',
  StarSelected: 'Selected',
  StarLost: 'LostLock',
  Paused: 'Paused',
}

function sameValues(before: Readonly<Record<string, Value>>, after: Readonly<Record<string, Value>>) {
  const names = Object.keys(after)

  return names.length === Object.keys(before).length && names.every(name => before[name] === after[name])
}

function propertyKey(device: string, property: string) {
  return `${device}\u0000${property}`
}

export function makePicture() {
  const properties = new Map<string, Property>()
  const writes = new Map<string, Written>()
  let rig: RigConnection | undefined
  let indi: IndiLink = 'unknown'
  let phd2: Phd2 = { link: 'unknown', state: undefined, changedAt: undefined, lastStepAt: undefined }
  let heardAt: number | undefined
  let ready = false

  function forgetDevices() {
    properties.clear()
    writes.clear()
  }

  function applyWire(entry: Entry) {
    const wire = readWireBody(entry)

    if (wire === undefined || wire.device === 'server' || wire.device === 'other') return

    if (wire.dir === 'out') {
      if (wire.type === 'new' && wire.property !== undefined) writes.set(propertyKey(wire.device, wire.property), { values: wire.elements, at: entry.at })

      return
    }

    if (wire.type === 'del') {
      if (wire.property === undefined) {
        for (const key of [...properties.keys()]) if (key.startsWith(`${wire.device}\u0000`)) properties.delete(key)
      } else properties.delete(propertyKey(wire.device, wire.property))

      return
    }

    if ((wire.type !== 'def' && wire.type !== 'set') || wire.property === undefined) return

    const key = propertyKey(wire.device, wire.property)
    const before = properties.get(key)
    const values = wire.type === 'def' || before === undefined ? wire.elements : { ...before.values, ...wire.elements }
    const state = wire.state ?? before?.state
    const changed = before === undefined || before.state !== state || !sameValues(before.values, values)

    properties.set(key, { state, values, limits: wire.type === 'def' ? wire.numbers : (before?.limits ?? {}), changedAt: changed ? entry.at : before.changedAt, confirmedAt: entry.at })
  }

  function applyClient(entry: Entry) {
    const body = recordOf(entry.body)

    if (body === undefined) return

    if (entry.kind === 'client.connected') {
      forgetDevices()
      indi = 'unknown'
      phd2 = { link: 'unknown', state: undefined, changedAt: undefined, lastStepAt: undefined }
      rig = {
        at: entry.at,
        run: typeof body['run'] === 'string' ? body['run'] : undefined,
        connection: typeof body['connection'] === 'number' ? body['connection'] : undefined,
        version: typeof body['version'] === 'string' ? body['version'] : undefined,
      }

      return
    }

    if (entry.kind !== 'client.connection') return

    const status = body['status']

    if (body['target'] === 'indiserver') {
      if (status === 'closed') {
        forgetDevices()
        indi = 'closed'
      } else if (status === 'connected') indi = 'connected'

      return
    }

    if (body['target'] === 'phd2' && (status === 'connected' || status === 'closed' || status === 'failed')) {
      phd2 = status === 'connected' ? { ...phd2, link: status } : { link: status, state: undefined, changedAt: entry.at, lastStepAt: undefined }
    }
  }

  function applyPhd2(entry: Entry) {
    const body = recordOf(entry.body)
    const event = body?.['Event']

    if (typeof event !== 'string') return

    const state = event === 'AppState' && typeof body?.['State'] === 'string' ? body['State'] : phd2StateOfEvent[event]

    if (state === undefined) {
      phd2 = { ...phd2, link: 'connected' }

      return
    }

    phd2 = { link: 'connected', state, changedAt: phd2.state === state ? phd2.changedAt : entry.at, lastStepAt: event === 'GuideStep' ? entry.at : phd2.lastStepAt }
  }

  return {
    apply(entry: Entry, receivedAt: number) {
      if (entry.kind.startsWith('client.')) applyClient(entry)
      else if (entry.kind === 'wire') applyWire(entry)
      else if (entry.kind.startsWith('phd2.')) applyPhd2(entry)
      else return

      heardAt = receivedAt
    },

    caughtUp() {
      ready = true
    },

    isReady: () => ready,
    property: (device: string, name: string) => properties.get(propertyKey(device, name)),
    written: (device: string, name: string) => writes.get(propertyKey(device, name)),
    rig: () => rig,
    indi: () => indi,
    phd2: () => phd2,
    heardAt: () => heardAt,
  }
}

export type Picture = ReturnType<typeof makePicture>
