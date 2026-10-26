import type { FrameType } from '@vela/model/web'

interface FrameTypeChoice {
  /** The choice as the Frame type field lists it. */
  label: string
  /** Names the saved frames: "Dark frames". Unused for light, which has a target to name it. */
  frames: string
  /** What to do before starting, shown under the field. */
  reminder?: string
}

/** Every frame type, in the order the Frame type field lists them. */
export const frameTypeChoices: Record<FrameType, FrameTypeChoice> = {
  light: { label: 'Light · target images', frames: 'Light frames' },
  dark: {
    label: 'Dark',
    frames: 'Dark frames',
    reminder: 'Cap the telescope or camera first. Vela cannot see the cap.',
  },
  flat: {
    label: 'Flat',
    frames: 'Flat frames',
    reminder: 'Aim at an evenly lit panel or sky. Vela does not point the mount for you.',
  },
  'dark-flat': {
    label: 'Dark flat',
    frames: 'Dark flat frames',
    reminder: 'Cap the telescope or camera first. Use the same exposure as your flats.',
  },
  bias: {
    label: 'Bias',
    frames: 'Bias frames',
    reminder: 'Cap the telescope or camera first. Use the shortest exposure, 0.1 seconds here.',
  },
}

// SAFETY: the keys of a record over every FrameType are exactly the FrameTypes, and there are five.
export const frameTypes = Object.keys(frameTypeChoices) as [FrameType, ...FrameType[]]

export function isCalibration(frameType: FrameType) {
  return frameType !== 'light'
}
