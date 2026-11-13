import { Result } from 'effect'
import { deviceProperties } from './devices.ts'
import { readWire, type Entry, type MalformedReading } from './entry.ts'

interface Wanted {
  readonly kinds: ReadonlyArray<string>
  readonly properties: Readonly<Record<string, ReadonlyArray<string>>>
}

export const wanted: Wanted = {
  kinds: [
    'vela.run.*',
    'vela.frame',
    'vela.frame.stats',
    'vela.focus.started',
    'vela.align.*',
    'vela.filter',
    'vela.focus.best',
    'vela.focus.sample',
    'vela.centre.*',
    'phd2.*',
    'client.connected',
    'client.connection',
    'command',
    'client.command',
  ],
  properties: deviceProperties,
}

const kindMatches = (kind: string) => (pattern: string) => (pattern.endsWith('.*') ? kind.startsWith(pattern.slice(0, -1)) : kind === pattern)

export function isWanted(entry: Entry): Result.Result<boolean, MalformedReading> {
  if (entry.kind !== 'wire') return Result.succeed(wanted.kinds.some(kindMatches(entry.kind)))

  return readWire(entry).pipe(Result.map(({ device, type, property }) => (property === undefined ? type === 'del' && wanted.properties[device] !== undefined : (wanted.properties[device]?.includes(property) ?? false))))
}
