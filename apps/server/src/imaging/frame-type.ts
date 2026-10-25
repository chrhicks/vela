import type { FrameType } from '@vela/model/web'

/**
 * The FITS `IMAGETYP` value for each frame type, in the spelling N.I.N.A. and most stacking
 * software read. This table is the list of frame types the server accepts.
 */
export const imageTypeKeyword = {
  light: 'LIGHT',
  dark: 'DARK',
  flat: 'FLAT',
  'dark-flat': 'DARKFLAT',
  bias: 'BIAS',
} as const satisfies Record<FrameType, string>

// SAFETY: the keys of a record over every FrameType are exactly the FrameTypes, and there are five.
export const frameTypes = Object.keys(imageTypeKeyword) as [FrameType, ...FrameType[]]
