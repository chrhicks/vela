import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { capturePreviews, previewPng, type ImageColor } from '../imaging/preview.js'
import { detailRegion, prepareAlignmentDisplay } from './display.js'

function decode(png: Buffer) {
  const chunks: Buffer[] = []

  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)

    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }

  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    rows: inflateSync(Buffer.concat(chunks)),
  }
}

function bayerFrame(width: number, height: number) {
  const pixels = Float64Array.from({ length: width * height }, (_, i) => (i * 7919) % 4000)
  pixels[3 * width + 1700] = 60_000
  const color: ImageColor = { kind: 'bayer', pattern: 'rggb' }

  return { width, height, pixels, color }
}

describe('alignment display', () => {
  it('produces the same fit derivative and native image as saved captures, from one stretch', async () => {
    const frame = bayerFrame(3203, 7)
    const before = frame.pixels.slice()
    const display = await prepareAlignmentDisplay(frame)
    const saved = await capturePreviews(frame.width, frame.height, frame.pixels, frame.color)

    expect(display.fitScale).toBe(3)
    expect(display.fit).toEqual(saved.fit)
    expect(decode(display.fit)).toMatchObject({ width: 1068, height: 3 })
    expect(await display.native()).toEqual(saved.native)
    expect(frame.pixels).toEqual(before)
  })

  it('keeps native pixels unchanged inside the detail region', async () => {
    const frame = bayerFrame(1000, 600)
    const display = await prepareAlignmentDisplay(frame)

    const region = detailRegion(frame, {
      reference: { x: 499.5, y: 299.5 },
      target: { x: 540, y: 280 },
      arcsecPerPixel: 1.94,
    })!

    const native = decode(await previewPng(frame.width, frame.height, frame.pixels, frame.color))
    const cropped = decode(await display.detail(region))
    const { x, y, width, height } = region
    expect(cropped).toMatchObject({ width, height })

    for (let row = 0; row < height; row++) {
      const nativeStart = (y + row) * (frame.width * 3 + 1) + 1 + x * 3
      const croppedStart = row * (width * 3 + 1) + 1

      expect(cropped.rows.subarray(croppedStart, croppedStart + width * 3)).toEqual(
        native.rows.subarray(nativeStart, nativeStart + width * 3),
      )
    }
  })

  it('stops preparing a display when its exposure work is cancelled', async () => {
    const controller = new AbortController()
    const pending = prepareAlignmentDisplay(bayerFrame(400, 400), controller.signal)
    controller.abort(new DOMException('Stopped', 'AbortError'))

    await expect(pending).rejects.toThrow('Stopped')
  })
})

describe('detail region', () => {
  const frame = { width: 6248, height: 4176 }
  const arcsecPerPixel = (2.2488 * 3600) / 4176
  const reference = { x: (frame.width - 1) / 2, y: (frame.height - 1) / 2 }

  // The browser inspection boxes, from apps/web/src/features/alignment/image-viewport.ts.
  function inspectionBoxes(target: { x: number; y: number }) {
    const dx = Math.abs(target.x - reference.x)
    const dy = Math.abs(target.y - reference.y)
    const minimum = 240 / arcsecPerPixel
    const fit = Math.max(minimum, dy * 1.5 + minimum / 2, (dx * 1.5) / 1.6 + minimum / 2)
    const centerX = (reference.x + target.x) / 2
    const centerY = (reference.y + target.y) / 2

    return [fit, 60 / arcsecPerPixel].map(height => ({
      left: centerX - (height * 1.6) / 2,
      right: centerX + (height * 1.6) / 2,
      top: centerY - height / 2,
      bottom: centerY + height / 2,
    }))
  }

  it.each([
    { x: reference.x + 1, y: reference.y - 2 },
    { x: reference.x - 60, y: reference.y + 15 },
    { x: reference.x + 300, y: reference.y + 400 },
    { x: reference.x - 650, y: reference.y },
  ])('covers the zoomed Fit both and Fine views within the image: %j', target => {
    const region = detailRegion(frame, { reference, target, arcsecPerPixel })!

    for (const box of inspectionBoxes(target)) {
      expect(region.x).toBeLessThanOrEqual(Math.max(0, box.left))
      expect(region.y).toBeLessThanOrEqual(Math.max(0, box.top))
      expect(region.x + region.width).toBeGreaterThanOrEqual(Math.min(frame.width, box.right))
      expect(region.y + region.height).toBeGreaterThanOrEqual(Math.min(frame.height, box.bottom))
    }
  })

  it('bounds large corrections and omits detail far outside the image', () => {
    const wide = detailRegion(frame, {
      reference,
      target: { x: reference.x + 3000, y: reference.y + 2000 },
      arcsecPerPixel,
    })!

    expect(Math.max(wide.width, wide.height)).toBeLessThanOrEqual(2048)
    expect(
      detailRegion(frame, { reference, target: { x: 40_000, y: 2000 }, arcsecPerPixel }),
    ).toBeUndefined()
    expect(
      detailRegion(frame, { reference, target: { x: Number.NaN, y: 0 }, arcsecPerPixel }),
    ).toBeUndefined()
  })
})
