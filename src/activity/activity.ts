import { readWireBody, recordOf, type Entry } from '../stream/entry.ts'

export type Topic = 'command' | 'run' | 'device' | 'driver'

export type Tone = 'plain' | 'good' | 'warn' | 'bad'

export interface Item {
  readonly id: number
  readonly night: string
  readonly at: number
  readonly topic: Topic
  readonly tone: Tone
  readonly text: string
  readonly link: string | undefined
}

export interface Activity {
  readonly night: string
  readonly items: ReadonlyArray<Item>
}

export interface ActivityOptions {
  readonly titles: Readonly<Record<string, string>>
  readonly nightOf: (at: number) => string
}

const actions: Readonly<Record<string, string>> = {
  CCD_EXPOSURE: 'Start an exposure',
  CCD_ABORT_EXPOSURE: 'Stop the exposure',
  CCD_FRAME_TYPE: 'Set the frame type',
  CCD_CONTROLS: 'Set gain and offset',
  CCD_GAIN: 'Set the gain',
  CCD_OFFSET: 'Set the offset',
  CCD_BINNING: 'Set the binning',
  CCD_COOLER: 'Cooler on or off',
  CCD_TEMPERATURE: 'Set the sensor temperature',
  UPLOAD_MODE: 'Set where frames go',
  UPLOAD_SETTINGS: 'Set the frame folder and name',
  FITS_HEADER: 'Write header keys',
  ABS_FOCUS_POSITION: 'Move focuser',
  REL_FOCUS_POSITION: 'Focuser in or out',
  FOCUS_MOTION: 'Set the focus direction',
  FOCUS_ABORT_MOTION: 'Stop focuser',
  EQUATORIAL_EOD_COORD: 'Slew mount to target',
  ON_COORD_SET: 'Set what a slew does',
  TELESCOPE_ABORT_MOTION: 'Stop mount',
  TELESCOPE_PARK: 'Park or unpark mount',
  TELESCOPE_HOME: 'Mount to Home',
  TELESCOPE_TRACK_STATE: 'Start or stop tracking',
  TELESCOPE_MOTION_NS: 'Move mount north or south',
  TELESCOPE_MOTION_WE: 'Move mount west or east',
  TELESCOPE_SLEW_RATE: 'Set the move speed',
}

const guiding: Readonly<Record<string, { readonly text: string; readonly tone: Tone }>> = {
  StartGuiding: { text: 'Guiding started.', tone: 'good' },
  GuidingStopped: { text: 'Guiding stopped.', tone: 'plain' },
  StarLost: { text: 'Guiding lost the star.', tone: 'warn' },
  StartCalibration: { text: 'Guiding calibration started.', tone: 'plain' },
  CalibrationComplete: { text: 'Guiding calibration done.', tone: 'good' },
  CalibrationFailed: { text: 'Guiding calibration failed.', tone: 'bad' },
}

const severity = /^\[(DEBUG|INFO|WARNING|ERROR)\]\s*/

function named(by: unknown) {
  return typeof by === 'string' && by !== '' ? by.charAt(0).toUpperCase() + by.slice(1) : 'Someone'
}

function text(value: unknown) {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined
}

export function makeActivity({ titles, nightOf }: ActivityOptions) {
  let night: string | undefined
  let items: Item[] = []
  let count = 0
  const connected = new Map<string, boolean>()

  function title(device: unknown) {
    return (typeof device === 'string' ? titles[device] : undefined) ?? (typeof device === 'string' && device !== 'server' && device !== 'other' ? device : 'INDI')
  }

  function add(at: number, topic: Topic, tone: Tone, line: string, link?: string) {
    const itemNight = nightOf(at)

    if (itemNight !== night) {
      if (night !== undefined && itemNight < night) return undefined
      night = itemNight
      items = []
    }

    count += 1

    const item: Item = { id: count, night: itemNight, at, topic, tone, text: line, link }

    items.push(item)

    return item
  }

  function command(entry: Entry) {
    const body = recordOf(entry.body)

    if (body === undefined || (body['result'] !== 'written' && body['result'] !== 'refused')) return undefined

    const property = text(body['property']) ?? 'a property'
    const asked = `${actions[property] ?? `Write ${property} to the ${title(body['device']).toLowerCase()}`} (${named(body['by'])})`

    return body['result'] === 'written'
      ? add(entry.at, 'command', 'plain', `${asked}: done.`)
      : add(entry.at, 'command', 'bad', `${asked}: refused, ${text(body['reason']) ?? 'no reason given'}.`)
  }

  function connection(entry: Entry) {
    const body = recordOf(entry.body)
    const status = body?.['status']

    if (body?.['target'] === 'indiserver') {
      if (status === 'connected') return add(entry.at, 'device', 'good', 'Connected to the INDI server.', '#/rig')
      if (status === 'closed') {
        connected.clear()
        return add(entry.at, 'device', 'bad', 'Lost the INDI server.', '#/rig')
      }
    }

    if (body?.['target'] === 'phd2') {
      if (status === 'connected') return add(entry.at, 'device', 'good', 'Connected to PHD2.', '#/rig')
      if (status === 'closed') return add(entry.at, 'device', 'warn', 'PHD2 closed the connection.', '#/rig')
      if (status === 'failed') return add(entry.at, 'device', 'warn', 'Could not reach PHD2.', '#/rig')
    }

    return undefined
  }

  function wire(entry: Entry) {
    const body = readWireBody(entry.body)

    if (body === undefined || body.dir !== 'in') return undefined

    if (body.type === 'message') {
      const message = text(recordOf(entry.body)?.['text'])?.trim()
      const level = message === undefined ? undefined : severity.exec(message)?.[1]

      if (message === undefined || message === '' || level === 'DEBUG') return undefined

      const tone = level === 'ERROR' ? 'bad' : level === 'WARNING' ? 'warn' : 'plain'

      return add(entry.at, 'driver', tone, `${title(body.device)}: ${message.replace(severity, '')}`)
    }

    if ((body.type === 'def' || body.type === 'set') && body.property === 'CONNECTION' && typeof body.elements['CONNECT'] === 'boolean') {
      const now = body.elements['CONNECT']

      if (connected.get(body.device) === now) return undefined

      connected.set(body.device, now)

      return now
        ? add(entry.at, 'device', 'good', `The ${title(body.device).toLowerCase()} connected.`, '#/rig')
        : add(entry.at, 'device', 'bad', `The ${title(body.device).toLowerCase()} disconnected.`, '#/rig')
    }

    return undefined
  }

  function run(entry: Entry) {
    const body = recordOf(entry.body) ?? {}

    if (entry.kind === 'vela.run.started') {
      const what = `${text(body['count']) ?? '?'} ${text(body['frameType']) ?? ''} frames${text(body['object']) ? ` of ${text(body['object'])}` : ''}`.replace(/\s+/g, ' ')

      return add(entry.at, 'run', 'good', `Run started: ${what}, ${text(body['exposureSeconds']) ?? '?'} s each, gain ${text(body['gain']) ?? '?'}, offset ${text(body['offset']) ?? '?'}.`, '#/capture')
    }

    if (entry.kind === 'vela.run.failed') return add(entry.at, 'run', 'warn', `An exposure failed${text(body['why']) ? `: ${text(body['why'])}` : ''}.`, '#/capture')

    if (entry.kind === 'vela.run.ended') {
      const detail = text(body['detail'])
      const reason = text(body['reason'])

      const counted = body['counted']

      if (reason === 'done') return add(entry.at, 'run', 'good', typeof counted === 'number' ? `Run finished: ${counted} ${counted === 1 ? 'frame' : 'frames'}.` : 'Run finished.', '#/capture')
      if (reason === 'stopped') return add(entry.at, 'run', 'plain', `Run stopped${detail ? `: ${detail}` : ''}.`, '#/capture')

      return add(entry.at, 'run', 'bad', `Run ended early${detail ? `: ${detail}` : reason ? `: ${reason}` : ''}.`, '#/capture')
    }

    if (entry.kind === 'vela.frame') {
      const file = text(body['file'])
      const frameNight = text(body['night'])
      const bytes = typeof body['bytes'] === 'number' ? ` (${(body['bytes'] / 1048576).toFixed(1)} MB)` : ''

      return file === undefined ? undefined : add(entry.at, 'run', 'plain', `Kept ${file}${bytes}, checked against the rig's copy.`, frameNight === undefined ? '#/frames' : `#/frames/${frameNight}/${file}`)
    }

    return undefined
  }

  return {
    observe(entry: Entry): Item | undefined {
      if (entry.kind === 'client.command') return command(entry)
      if (entry.kind === 'client.connection') return connection(entry)
      if (entry.kind === 'client.connected') {
        connected.clear()
        const version = text(recordOf(entry.body)?.['version'])
        return add(entry.at, 'device', 'plain', `The rig program started${version ? ` (version ${version})` : ''}.`, '#/rig')
      }
      if (entry.kind === 'wire') return wire(entry)
      if (entry.kind.startsWith('vela.')) return run(entry)
      if (entry.kind.startsWith('phd2.')) {
        const event = text(recordOf(entry.body)?.['Event'])
        const known = event === undefined ? undefined : guiding[event]
        return known === undefined ? undefined : add(entry.at, 'device', known.tone, known.text, '#/rig')
      }
      return undefined
    },

    view(now: number): Activity {
      const current = nightOf(now)

      return { night: current, items: night === current ? items : [] }
    },
  }
}
