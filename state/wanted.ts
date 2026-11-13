import { Result } from 'effect'
import { deviceProperties } from './devices.ts'
import { isRigKind } from './entries.ts'
import { readWire, type Entry, type MalformedReading } from './entry.ts'

const properties: Readonly<Record<string, ReadonlyArray<string>>> = deviceProperties

export function isWanted(entry: Entry): Result.Result<boolean, MalformedReading> {
  if (entry.kind !== 'wire') return Result.succeed(isRigKind(entry.kind))

  return readWire(entry).pipe(Result.map(({ device, type, property }) => (property === undefined ? type === 'del' && properties[device] !== undefined : (properties[device]?.includes(property) ?? false))))
}
