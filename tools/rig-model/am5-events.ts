import { decodeRecordingLine, parseMessage, parseRequest, type PropertyState, type Vector } from '@vela/rig-events'
import { displayStep } from './indi-format.ts'

/** What a client asked the mount to do. Requests from other clients reach Cria too, relayed by indiserver, and count the same. A rate move is `move-start` until the matching `move-stop`. */
export type Command =
  | { readonly kind: 'goto'; readonly raHours: number; readonly decDegrees: number }
  | { readonly kind: 'home' }
  | { readonly kind: 'move-start' }
  | { readonly kind: 'move-stop' }
  | { readonly kind: 'abort' }
  | { readonly kind: 'guide' }

/** One thing a recording shows about the mount, in file order. */
export type MountEvent =
  | { readonly type: 'command'; readonly at: number; readonly command: Command }
  | { readonly type: 'position'; readonly at: number; readonly state: PropertyState; readonly raHours: number; readonly decDegrees: number }
  | { readonly type: 'tracking'; readonly at: number; readonly on: boolean }
  | { readonly type: 'rate'; readonly at: number; readonly name: string }
  | { readonly type: 'steps'; readonly raHours: number; readonly decDegrees: number }
  | { readonly type: 'gap'; readonly at: number }
  | { readonly type: 'end'; readonly at: number }

const position = 'EQUATORIAL_EOD_COORD'

function numberOf(vector: Vector, name: string): number | undefined {
  const element = vector.elements.get(name)

  return element?.kind === 'number' ? element.value : undefined
}

const isOn = (vector: Vector, name: string) => {
  const element = vector.elements.get(name)

  return element?.kind === 'switch' && element.on
}

const anyOn = (vector: Vector) => [...vector.elements.values()].some(element => element.kind === 'switch' && element.on)

function commandOf(request: Vector): Command | undefined {
  switch (request.name) {
    case position: {
      const raHours = numberOf(request, 'RA')
      const decDegrees = numberOf(request, 'DEC')

      return raHours === undefined || decDegrees === undefined ? undefined : { kind: 'goto', raHours, decDegrees }
    }

    case 'TELESCOPE_HOME':
      return isOn(request, 'GO') ? { kind: 'home' } : undefined
    case 'TELESCOPE_MOTION_WE':
    case 'TELESCOPE_MOTION_NS':
      return anyOn(request) ? { kind: 'move-start' } : { kind: 'move-stop' }
    case 'TELESCOPE_ABORT_MOTION':
      return isOn(request, 'ABORT') ? { kind: 'abort' } : undefined
    case 'TELESCOPE_TIMED_GUIDE_NS':
    case 'TELESCOPE_TIMED_GUIDE_WE':
      return { kind: 'guide' }
    default:
      return undefined
  }
}

function readingOf(vector: Vector, at: number): MountEvent | undefined {
  switch (vector.name) {
    case position: {
      const raHours = numberOf(vector, 'RA')
      const decDegrees = numberOf(vector, 'DEC')

      if (raHours === undefined || decDegrees === undefined || vector.state === undefined) return undefined

      return { type: 'position', at, state: vector.state, raHours, decDegrees }
    }

    case 'TELESCOPE_TRACK_STATE':
      return vector.elements.has('TRACK_ON') ? { type: 'tracking', at, on: isOn(vector, 'TRACK_ON') } : undefined
    case 'TELESCOPE_SLEW_RATE': {
      const selected = [...vector.elements].find(([, element]) => element.kind === 'switch' && element.on)

      return selected === undefined ? undefined : { type: 'rate', at, name: selected[0] }
    }

    default:
      return undefined
  }
}

/** The display step of the RA and Dec numbers, from the property definition (`format="%010.6m"`). */
function stepsOf(xml: string): MountEvent | undefined {
  const format = (axis: string) => new RegExp(`<defNumber name="${axis}"[^>]*format="([^"]*)"`).exec(xml)?.[1]

  const ra = format('RA')
  const dec = format('DEC')

  return ra === undefined || dec === undefined ? undefined : { type: 'steps', raHours: displayStep(ra), decDegrees: displayStep(dec) }
}

/**
 * Reads one `traffic.jsonl` line into what it says about the mount `device`; an empty list if it says nothing the
 * profile uses. Throws on a line that is not JSON or holds an INDI value INDI does not allow.
 */
export function eventsOf(line: string, device: string): MountEvent[] {
  const recorded = decodeRecordingLine(JSON.parse(line))

  if (recorded.k === 'gap' || recorded.k === 'end') return [{ type: recorded.k, at: recorded.at }]

  if (recorded.k !== 'msg') return []

  const { at, dir, xml } = recorded
  const request = parseRequest(xml)

  if (request !== undefined) {
    const command = request.device === device ? commandOf(request) : undefined

    return command === undefined ? [] : [{ type: 'command', at, command }]
  }

  if (dir === 'out') return []

  const message = parseMessage(xml)

  if (message === undefined || message.type === 'del' || message.vector.device !== device) return []

  const reading = readingOf(message.vector, at)
  const steps = message.type === 'def' && message.vector.name === position ? stepsOf(xml) : undefined

  return [steps, reading].filter(event => event !== undefined)
}

/** True for a line worth parsing. A recording holds about a million lines a night and almost all are other devices or keep-alives. */
export const mayConcern = (line: string, device: string) => line.includes(device) ? line.includes('Vector') && !line.includes('<getProperties') : line.startsWith('{"k":"gap"') || line.startsWith('{"k":"end"')
