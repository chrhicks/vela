import { Option, Schema } from 'effect'
import type { Entry } from './entry.ts'

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
    'vela.focus.best',
    'vela.centre.*',
    'phd2.*',
    'client.connected',
    'client.connection',
    'command',
    'client.command',
  ],
  properties: {
    mount: ['CONNECTION', 'EQUATORIAL_EOD_COORD', 'TELESCOPE_TRACK_STATE', 'TELESCOPE_PIER_SIDE', 'TELESCOPE_PARK', 'MERIDIAN_LIMIT', 'GEOGRAPHIC_COORD'],
    primary: ['CONNECTION', 'CCD_TEMPERATURE', 'CCD_COOLER'],
    focuser: ['CONNECTION', 'ABS_FOCUS_POSITION', 'FOCUS_TEMPERATURE'],
    box: ['CONNECTION', 'DEW_DUTY_CYCLES', 'DEW_LABELS', 'WEATHER_PARAMETERS'],
    guide: ['CONNECTION'],
  },
}

const decodeReading = Schema.decodeUnknownOption(Schema.Struct({ device: Schema.String, property: Schema.String }))

const kindMatches = (kind: string) => (pattern: string) => (pattern.endsWith('.*') ? kind.startsWith(pattern.slice(0, -1)) : kind === pattern)

export function isWanted(entry: Entry): boolean {
  if (entry.kind !== 'wire') return wanted.kinds.some(kindMatches(entry.kind))

  return Option.match(decodeReading(entry.body), {
    onNone: () => false,
    onSome: ({ device, property }) => wanted.properties[device]?.includes(property) ?? false,
  })
}
