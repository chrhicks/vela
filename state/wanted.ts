import { Result } from 'effect'
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
  properties: {
    mount: ['CONNECTION', 'EQUATORIAL_EOD_COORD', 'TELESCOPE_TRACK_STATE', 'TELESCOPE_PIER_SIDE', 'TELESCOPE_PARK', 'MERIDIAN_LIMIT', 'GEOGRAPHIC_COORD', 'TIME_UTC', 'DEBUG', 'DEBUG_LEVEL'],
    primary: ['CONNECTION', 'CCD_TEMPERATURE', 'CCD_COOLER', 'CCD_COOLER_POWER', 'CCD_CONTROLS', 'UPLOAD_MODE', 'SCOPE_INFO'],
    focuser: ['CONNECTION', 'ABS_FOCUS_POSITION', 'FOCUS_TEMPERATURE'],
    box: ['CONNECTION', 'DEW_DUTY_CYCLES', 'DEW_LABELS', 'AUTO_DEW_CONTROL', 'WEATHER_PARAMETERS'],
    guide: ['CONNECTION'],
  },
}

const kindMatches = (kind: string) => (pattern: string) => (pattern.endsWith('.*') ? kind.startsWith(pattern.slice(0, -1)) : kind === pattern)

export function isWanted(entry: Entry): Result.Result<boolean, MalformedReading> {
  if (entry.kind !== 'wire') return Result.succeed(wanted.kinds.some(kindMatches(entry.kind)))

  return readWire(entry).pipe(Result.map(({ device, type, property }) => (property === undefined ? type === 'del' && wanted.properties[device] !== undefined : (wanted.properties[device]?.includes(property) ?? false))))
}
