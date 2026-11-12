import type { FrameFile, NightName, RigEntry } from './entries.ts'

export interface Measurements {
  readonly stars: number | null
  readonly hfdPixels: number | null
  readonly elongation: number | null
  readonly sky: number
  readonly noise: number
}

export interface Frame {
  readonly night: NightName
  readonly file: FrameFile
  readonly keptAt: number
  readonly measurements: Measurements | undefined
}

const sameFrame = (night: NightName, file: FrameFile) => (frame: Frame) => frame.night === night && frame.file === file

export function frames(state: ReadonlyArray<Frame>, entry: RigEntry): ReadonlyArray<Frame> {
  switch (entry.kind) {
    case 'vela.frame': {
      const { night, file } = entry.body

      if (state.some(sameFrame(night, file))) return state

      return [...state, { night, file, keptAt: entry.at, measurements: undefined }]
    }
    case 'vela.frame.stats': {
      const { night, file, stars, hfdPixels, elongation, sky, noise } = entry.body
      const isMeasured = sameFrame(night, file)

      if (!state.some(isMeasured)) return state

      return state.map(frame => (isMeasured(frame) ? { ...frame, measurements: { stars, hfdPixels, elongation, sky, noise } } : frame))
    }
    default:
      return state
  }
}
