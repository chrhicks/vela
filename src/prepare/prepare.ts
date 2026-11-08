import { Schema } from 'effect'
import { decodeConfig } from '../config.ts'
import type { Picture } from '../rig/picture.ts'
import type { Sender } from '../commands/sender.ts'

const Request = Schema.Union([
  Schema.Struct({ action: Schema.Literal('focuser-move'), position: Schema.Finite }),
  Schema.Struct({ action: Schema.Literal('focuser-nudge'), direction: Schema.Literals(['in', 'out']) }),
  Schema.Struct({ action: Schema.Literal('focuser-stop') }),
  Schema.Struct({ action: Schema.Literal('dew-channel'), channel: Schema.String, on: Schema.Boolean }),
  Schema.Struct({ action: Schema.Literal('dew-duty'), channel: Schema.String, percent: Schema.Finite }),
  Schema.Struct({ action: Schema.Literal('dew-auto'), on: Schema.Boolean }),
])

export type PrepareResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export interface PrepareSettings {
  readonly focuser: string
  readonly box: string
  readonly focuserNudgeSteps: number
}

export interface PrepareOptions {
  readonly picture: Pick<Picture, 'property'>
  readonly sender: Pick<Sender, 'send'>
  readonly settings: PrepareSettings
}

const refuse = (reason: string): PrepareResult => ({ ok: false, reason })

export function makePrepare({ picture, sender, settings }: PrepareOptions) {
  const { focuser, box, focuserNudgeSteps } = settings

  async function write(device: string, property: string, values: Readonly<Record<string, number | boolean>>, stop = false): Promise<PrepareResult> {
    const outcome = await sender.send({ device, property, values }, stop)

    return outcome.result === 'written' ? { ok: true } : refuse(`${property}: ${outcome.reason}`)
  }

  function outside(value: number, limits: { readonly min: number; readonly max: number } | undefined, what: string) {
    return limits !== undefined && (value < limits.min || value > limits.max) ? `${what} ${value} is outside the limits the driver gives, ${limits.min} to ${limits.max}` : undefined
  }

  async function move(position: number): Promise<PrepareResult> {
    const absolute = picture.property(focuser, 'ABS_FOCUS_POSITION')

    if (absolute === undefined) return refuse(`${focuser} has no ABS_FOCUS_POSITION on the stream`)
    if (!Number.isInteger(position)) return refuse('a focuser position is a whole number of steps')

    const problem = outside(position, absolute.limits['FOCUS_ABSOLUTE_POSITION'], 'position')

    return problem === undefined ? write(focuser, 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: position }) : refuse(problem)
  }

  async function nudge(direction: 'in' | 'out'): Promise<PrepareResult> {
    const absolute = picture.property(focuser, 'ABS_FOCUS_POSITION')
    const relative = picture.property(focuser, 'REL_FOCUS_POSITION')
    const current = absolute?.values['FOCUS_ABSOLUTE_POSITION']

    if (relative === undefined || picture.property(focuser, 'FOCUS_MOTION') === undefined) return refuse(`${focuser} has no REL_FOCUS_POSITION and FOCUS_MOTION on the stream`)
    if (typeof current !== 'number') return refuse('the focuser position is not known')

    const problem =
      outside(focuserNudgeSteps, relative.limits['FOCUS_RELATIVE_POSITION'], 'nudge') ??
      outside(direction === 'in' ? current - focuserNudgeSteps : current + focuserNudgeSteps, absolute?.limits['FOCUS_ABSOLUTE_POSITION'], 'position after the nudge')

    if (problem !== undefined) return refuse(problem)

    const turned = await write(focuser, 'FOCUS_MOTION', { FOCUS_INWARD: direction === 'in', FOCUS_OUTWARD: direction === 'out' })

    return turned.ok ? write(focuser, 'REL_FOCUS_POSITION', { FOCUS_RELATIVE_POSITION: focuserNudgeSteps }) : turned
  }

  async function dewChannel(channel: string, on: boolean): Promise<PrepareResult> {
    const channels = picture.property(box, 'DEW_CHANNELS')

    if (channels === undefined) return refuse(`${box} has no DEW_CHANNELS on the stream`)

    return channel in channels.values ? write(box, 'DEW_CHANNELS', { [channel]: on }) : refuse(`${box} has no dew output ${channel}`)
  }

  async function dewDuty(channel: string, percent: number): Promise<PrepareResult> {
    const duty = picture.property(box, 'DEW_DUTY_CYCLES')

    if (duty === undefined) return refuse(`${box} has no DEW_DUTY_CYCLES on the stream`)
    if (!(channel in duty.values)) return refuse(`${box} has no dew output ${channel}`)

    const problem = outside(percent, duty.limits[channel], 'duty')

    return problem === undefined ? write(box, 'DEW_DUTY_CYCLES', { [channel]: percent }) : refuse(problem)
  }

  async function dewAuto(on: boolean): Promise<PrepareResult> {
    const automatic = picture.property(box, 'AUTO_DEW_CONTROL')

    if (automatic === undefined) return refuse(`${box} has no AUTO_DEW_CONTROL on the stream`)

    return write(box, 'AUTO_DEW_CONTROL', Object.fromEntries(Object.keys(automatic.values).map(element => [element, on])))
  }

  return {
    async act(json: unknown): Promise<PrepareResult> {
      let request: typeof Request.Type

      try {
        request = decodeConfig(Request, json)
      } catch (error) {
        return refuse(`not a preparation request: ${error instanceof Error ? error.message : String(error)}`)
      }

      switch (request.action) {
        case 'focuser-move':
          return move(request.position)
        case 'focuser-nudge':
          return nudge(request.direction)
        case 'focuser-stop':
          return write(focuser, 'FOCUS_ABORT_MOTION', { ABORT: true }, true)
        case 'dew-channel':
          return dewChannel(request.channel, request.on)
        case 'dew-duty':
          return dewDuty(request.channel, request.percent)
        case 'dew-auto':
          return dewAuto(request.on)
      }
    },
  }
}

export type Prepare = ReturnType<typeof makePrepare>
