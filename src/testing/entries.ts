import { StreamPosition, type Entry } from '../../state/entry.ts'

type Elements = Readonly<Record<string, number | boolean | string>>

export const startedAt = Date.UTC(2026, 10, 8, 3, 0, 0)

export const run = 'run-a'

export const phoenixLongitude = 360 - 112.07

let seq = 0

function entry(kind: string, at: number, body: unknown): Entry {
  seq += 1

  return { seq: StreamPosition.make(seq), kind, at, body }
}

export function connected(at: number, connection = 1, withRun = run): Entry {
  return entry('client.connected', at, { client: 'rig', run: withRun, connection, version: 'abc1234', sources: ['wire'], wireDevices: {} })
}

export function indiserver(at: number, status: 'connected' | 'closed'): Entry {
  return entry('client.connection', at, { target: 'indiserver', status, ...(status === 'closed' ? { error: 'gone' } : {}) })
}

export function phd2Link(at: number, status: 'connected' | 'closed' | 'failed'): Entry {
  return entry('client.connection', at, { target: 'phd2', status })
}

export function wire(at: number, type: 'def' | 'set' | 'new' | 'del', device: string, property: string | undefined, elements: Elements, state?: string, dir: 'in' | 'out' = type === 'new' ? 'out' : 'in', limits: Readonly<Record<string, { min: number; max: number }>> = {}): Entry {
  return entry('wire', at, { dir, n: 1, xml: '', device, type, indiDevice: `${device} (indi)`, ...(property === undefined ? {} : { property }), ...(state === undefined ? {} : { state }), elements, ...(Object.keys(limits).length === 0 ? {} : { numbers: Object.fromEntries(Object.entries(limits).map(([name, range]) => [name, { ...range, step: 1, format: '%g' }])) }) })
}


export function phd2(at: number, event: Readonly<Record<string, unknown>>): Entry {
  return entry(`phd2.${String(event['Event'])}`, at, { Timestamp: at / 1000, ...event })
}
