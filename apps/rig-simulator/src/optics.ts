// Fast frames sample the same synthetic sensor at one quarter the resolution.
// RGGB is generated at the selected sampling, not binned from a color image.
export const imageWidth = 1562

export const imageHeight = 1044

export const fieldHeightDegrees = 3

export const focalLengthMm = 4176 * 3.76 / (2000 * Math.tan(fieldHeightDegrees * Math.PI / 360))

export function cameraGeometry(resolution: 'fast' | 'full') {
  return resolution === 'full'
    ? { width: 6248, height: 4176, pixelSizeMicrons: 3.76 }
    : { width: imageWidth, height: imageHeight, pixelSizeMicrons: 15.04 }
}
