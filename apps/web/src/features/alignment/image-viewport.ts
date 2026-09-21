import type { AlignmentView } from '@vela/model/web'

export type AlignmentMeasurement = NonNullable<AlignmentView['measurement']>

export type AlignmentImageView = 'fit' | 'fine' | 'full' | 'native'

/** Display geometry only: the server already projected the correction through WCS. */
export function alignmentViewport(
  measurement: AlignmentMeasurement,
  view: Exclude<AlignmentImageView, 'native'>,
) {
  const referenceX = (measurement.imageWidth - 1) / 2
  const referenceY = (measurement.imageHeight - 1) / 2
  const arcsecPerPixel = (measurement.fieldHeightDegrees * 3600) / measurement.imageHeight
  const dx = Math.abs(measurement.targetX - referenceX)
  const dy = Math.abs(measurement.targetY - referenceY)
  const minimumHeight = 240 / arcsecPerPixel

  const heights = {
    full: measurement.imageHeight,
    fine: 60 / arcsecPerPixel,
    fit: Math.max(
      minimumHeight,
      dy * 1.5 + minimumHeight / 2,
      (dx * 1.5) / 1.6 + minimumHeight / 2,
    ),
  }

  const height = heights[view]
  const width = view === 'full' ? measurement.imageWidth : height * 1.6

  const centerX =
    view === 'full' ? measurement.imageWidth / 2 : (referenceX + measurement.targetX) / 2

  const centerY =
    view === 'full' ? measurement.imageHeight / 2 : (referenceY + measurement.targetY) / 2

  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height,
    referenceX,
    referenceY,
    barArcsec: (width * arcsecPerPixel) / 5,
    outsideImage:
      measurement.targetX < 0 ||
      measurement.targetX > measurement.imageWidth - 1 ||
      measurement.targetY < 0 ||
      measurement.targetY > measurement.imageHeight - 1,
    markersClipped:
      dx / 2 + (width * 30) / 640 > width / 2 || dy / 2 + (width * 30) / 640 > height / 2,
  }
}

export function angularScaleLabel(arcsec: number) {
  return arcsec < 60 ? `${Math.round(arcsec)}″` : `${(arcsec / 60).toFixed(1)}′`
}
