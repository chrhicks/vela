import { describe, expect, it } from 'vitest'
import { alignmentViewport } from './image-viewport'
import type { AlignmentMeasurement } from './image-viewport'

const measurement: AlignmentMeasurement = {
  imageWidth: 1600, imageHeight: 1200, fieldHeightDegrees: 2,
  imageUrl: '/api/frame.png', targetX: 799.5, targetY: 599.5,
  totalArcsec: 0, altitudeArcsec: 0, azimuthArcsec: 0,
}

describe('alignment display viewport', () => {
  it('uses each image field and dimensions for the 4′ floor and 1′ fine view', () => {
    for (const fieldHeightDegrees of [0.5, 2, 3]) {
      const frame = { ...measurement, fieldHeightDegrees }
      const fit = alignmentViewport(frame, 'fit')
      const fine = alignmentViewport(frame, 'fine')
      expect(fit.height / frame.imageHeight * fieldHeightDegrees * 60).toBeCloseTo(4)
      expect(fine.height / frame.imageHeight * fieldHeightDegrees * 60).toBeCloseTo(1)
      expect(fine.barArcsec).toBeCloseTo(19.2)
      expect(fit.referenceX).toBe(799.5)
      expect(fit.referenceY).toBe(599.5)
    }
  })

  it('fits server-projected off-image targets in any direction without clamping them to the image', () => {
    for (const [targetX, targetY] of [[-900, 599.5], [3000, 1900], [799.5, -2000]]) {
      const frame = { ...measurement, targetX: targetX!, targetY: targetY! }
      const box = alignmentViewport(frame, 'fit')
      expect(box.outsideImage).toBe(true)
      expect(box.markersClipped).toBe(false)

      for (const [x, y] of [[box.referenceX, box.referenceY], [frame.targetX, frame.targetY]]) {
        expect(x).toBeGreaterThan(box.left + box.width * 0.08)
        expect(x).toBeLessThan(box.left + box.width * 0.92)
        expect(y).toBeGreaterThan(box.top + box.height * 0.08)
        expect(y).toBeLessThan(box.top + box.height * 0.92)
      }

      expect(alignmentViewport(frame, 'fine').markersClipped).toBe(true)
    }
  })

  it('keeps a full frame tied to sensor bounds, and does not confuse a clipped fine view with an off-image target', () => {
    const frame = { ...measurement, targetX: 900, targetY: 650 }
    expect(alignmentViewport(frame, 'full')).toMatchObject({ left: 0, top: 0, width: 1600, height: 1200, outsideImage: false })
    expect(alignmentViewport(frame, 'fine')).toMatchObject({ outsideImage: false, markersClipped: true })
  })
})
