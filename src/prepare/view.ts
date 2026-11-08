import type { Picture } from '../rig/picture.ts'

export interface DewChannel {
  readonly id: string
  readonly label: string
  readonly on: boolean | undefined
  readonly duty: number | undefined
  readonly min: number | undefined
  readonly max: number | undefined
}

export interface PrepareView {
  readonly focuser: {
    readonly known: boolean
    readonly position: number | undefined
    readonly min: number | undefined
    readonly max: number | undefined
    readonly moving: boolean
    readonly nudgeSteps: number
  }
  readonly dew: {
    readonly channels: ReadonlyArray<DewChannel>
    readonly auto: boolean | undefined
  }
}

export interface PrepareViewSettings {
  readonly focuser: string
  readonly box: string
  readonly focuserNudgeSteps: number
}

const onOf = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
const numberOf = (value: unknown) => (typeof value === 'number' ? value : undefined)

export function makePrepareView(picture: Pick<Picture, 'property'>, { focuser, box, focuserNudgeSteps }: PrepareViewSettings): PrepareView {
  const absolute = picture.property(focuser, 'ABS_FOCUS_POSITION')
  const limits = absolute?.limits['FOCUS_ABSOLUTE_POSITION']
  const channels = picture.property(box, 'DEW_CHANNELS')
  const duty = picture.property(box, 'DEW_DUTY_CYCLES')
  const labels = picture.property(box, 'DEW_LABELS')
  const automatic = picture.property(box, 'AUTO_DEW_CONTROL')
  const autoStates = Object.values(automatic?.values ?? {}).map(onOf)

  return {
    focuser: {
      known: absolute !== undefined,
      position: numberOf(absolute?.values['FOCUS_ABSOLUTE_POSITION']),
      min: limits?.min,
      max: limits?.max,
      moving: absolute?.state === 'Busy',
      nudgeSteps: focuserNudgeSteps,
    },
    dew: {
      channels: Object.keys(channels?.values ?? {})
        .sort()
        .map(id => {
          const label = labels?.values[id]

          return {
            id,
            label: typeof label === 'string' && label !== '' ? label : id,
            on: onOf(channels?.values[id]),
            duty: numberOf(duty?.values[id]),
            min: duty?.limits[id]?.min,
            max: duty?.limits[id]?.max,
          }
        }),
      auto: autoStates.length === 0 || autoStates.includes(undefined) ? undefined : autoStates.every(Boolean),
    },
  }
}
