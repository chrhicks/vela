export interface Extent {
  readonly width: number
  readonly height: number
}

export interface Share {
  readonly x: number
  readonly y: number
}

export interface PixelBox extends Extent {
  readonly x: number
  readonly y: number
}

const fitted = (centre: number, size: number, whole: number) => Math.min(whole - size, Math.max(0, Math.round(centre - size / 2)))

export function boxAround(frame: Extent, size: Extent, centre: Share): PixelBox {
  const width = Math.max(1, Math.min(frame.width, Math.round(size.width)))
  const height = Math.max(1, Math.min(frame.height, Math.round(size.height)))

  return { x: fitted(centre.x * frame.width, width, frame.width), y: fitted(centre.y * frame.height, height, frame.height), width, height }
}
