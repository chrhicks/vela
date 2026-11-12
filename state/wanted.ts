import { readWireBody, type Entry } from './entry.ts'

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

function kindMatches(pattern: string, kind: string) {
  return pattern.endsWith('.*') ? kind.startsWith(pattern.slice(0, -1)) : kind === pattern
}

export function isWanted(entry: Entry): boolean {
  if (entry.kind !== 'wire') return wanted.kinds.some(pattern => kindMatches(pattern, entry.kind))

  const wire = readWireBody(entry.body)

  return wire?.property !== undefined && (wanted.properties[wire.device]?.includes(wire.property) ?? false)
}
