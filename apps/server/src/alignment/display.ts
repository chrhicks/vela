import {
  fitFactor,
  fitPng,
  nativePng,
  regionPng,
  stretchImage,
  type ImageColor,
  type ImageRegion,
} from '../imaging/preview.js'

/** Native-resolution detail extends at most this far from its center: 2047 pixels across. */
const MAX_DETAIL_HALF = 1023

export interface AlignmentDisplayFrame {
  width: number
  height: number
  pixels: ArrayLike<number>
  color: ImageColor
}

/**
 * Display derivatives of one exposure, all from the same stretch. Normal feedback
 * uses the fit image and, once a correction is known, native pixels around it.
 * The full native image is rendered only if someone asks for 100% inspection.
 */
export interface AlignmentDisplay {
  readonly fit: Buffer
  /** Native pixels per fit pixel along each axis. */
  readonly fitScale: number
  /** The same native display pixels within a region, typically from `detailRegion`. */
  detail(region: ImageRegion): Promise<Buffer>
  native(): Promise<Buffer>
}

interface Point {
  x: number
  y: number
}

export interface DetailCorrection {
  reference: Point
  target: Point
  arcsecPerPixel: number
}

export async function prepareAlignmentDisplay(
  frame: AlignmentDisplayFrame,
  signal?: AbortSignal,
): Promise<AlignmentDisplay> {
  const image = await stretchImage(frame.width, frame.height, frame.pixels, frame.color, signal)
  const fitScale = fitFactor(frame.width, frame.height)
  const fit = await fitPng(image, fitScale, signal)
  let native: Promise<Buffer> | undefined

  return {
    fit,
    fitScale,
    detail: region => regionPng(image, region),
    native: () => (native ??= nativePng(image)),
  }
}

/**
 * A square of native pixels centered between the reference and the correction
 * target. It covers the browser's Fit both and Fine views (a padded box with a
 * 4′ minimum height and 1.6 aspect), which zoom past the fit image's resolution.
 * Wider views are shown at or below fit resolution.
 */
export function detailRegion(
  frame: Pick<AlignmentDisplayFrame, 'width' | 'height'>,
  { reference, target, arcsecPerPixel }: DetailCorrection,
): ImageRegion | undefined {
  if (
    ![reference.x, reference.y, target.x, target.y].every(Number.isFinite) ||
    !(arcsecPerPixel > 0)
  )
    return undefined

  const separation = Math.max(Math.abs(target.x - reference.x), Math.abs(target.y - reference.y))
  const margin = Math.max(128, 200 / arcsecPerPixel)
  const half = Math.min(MAX_DETAIL_HALF, Math.ceil(separation * 1.2 + margin))
  const centerX = (reference.x + target.x) / 2
  const centerY = (reference.y + target.y) / 2
  const startX = Math.floor(centerX - half)
  const startY = Math.floor(centerY - half)
  const left = clamp(startX, 0, frame.width)
  const top = clamp(startY, 0, frame.height)
  const right = clamp(startX + 2 * half + 1, 0, frame.width)
  const bottom = clamp(startY + 2 * half + 1, 0, frame.height)

  if (right <= left || bottom <= top) return undefined

  return { x: left, y: top, width: right - left, height: bottom - top }
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))
