import { describe, expect, it } from 'vitest'
import { makePreviewRgb } from '../frames/preview.ts'
import { syntheticFits } from '../testing/fits.ts'
import { pictureFor } from './image.ts'
import { messageParams, type ReviewFacts, type ReviewRequest, type TrendRow } from './request.ts'

const phoenix = { latitude: 33.45, longitude: -112.07, elevation: 331 }

const frameWithHeaders = (seed: number) =>
  syntheticFits({
    width: 64,
    height: 48,
    pattern: 'RGGB',
    pixel: (x, y) => 1000 + ((x * 7 + y * 13 + seed) % 11) * 30 + (x === 20 && y === 20 ? 30000 : 0),
    extra: { 'DATE-OBS': '2026-11-18T05:12:09', SITELAT: phoenix.latitude, SITELONG: phoenix.longitude, SITEELEV: phoenix.elevation, OBJCTRA: '21 39 06', OBJCTDEC: '+57 29 20', OBJECT: 'IC 1396', TELESCOP: 'Test scope' },
  })

const row = (minutes: number, hfdPixels: number, stars: number): TrendRow => ({ minutes, hfdPixels, stars, elongation: 1.1, sky: 1200, noise: 30, altitudeDegrees: 48, azimuthDegrees: 61 })

const facts: ReviewFacts = {
  target: 'IC 1396',
  exposureSeconds: 180,
  filter: 'Dual band',
  reasons: ['hfd', 'stars'],
  baseline: { hfdPixels: 2.4, stars: 2900 },
  lastGood: row(95, 2.5, 2850),
  current: row(110, 3.3, 1900),
  trend: [row(95, 2.5, 2850), row(98, 2.6, 2700), row(101, 2.8, 2400), row(104, 3, 2200), row(107, 3.2, 2000), row(110, 3.3, 1900)],
  events: [{ minutes: 105, event: 'StarLost' }, { minutes: 106, event: 'StarLost' }, { minutes: 107, event: 'SettleFailed' }],
}

const picture = (seed: number) => pictureFor(makePreviewRgb(frameWithHeaders(seed), { bin: 1, blackSigmas: 2.8, targetMedian: 0.25 }), 1568, 4_500_000)

const request: ReviewRequest = { good: picture(1), current: picture(2), facts }

const settings: Parameters<typeof messageParams>[0] = { effort: 'high', maxTokens: 16000 }

const chunkTypes = (png: Buffer) => {
  const types: string[] = []

  for (let at = 8; at + 12 <= png.length; at += 12 + png.readUInt32BE(at)) types.push(png.toString('latin1', at + 4, at + 8))

  return types
}

const bodyOf = (model: string) => messageParams(settings, model, request)

const textOf = (model: string) => {
  const body = bodyOf(model)
  const content = body.messages[0]?.content

  return JSON.stringify({ system: body.system, blocks: Array.isArray(content) ? content.filter(block => block.type === 'text') : content })
}

describe('what an ask sends', () => {
  it('asks each model the same request, naming the model, with adaptive thinking and a structured answer', () => {
    const { model: opus, ...opusRest } = bodyOf('claude-opus-5-5')
    const { model: haiku, ...haikuRest } = bodyOf('claude-haiku-5-5')

    expect([opus, haiku]).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(opusRest).toEqual(haikuRest)
    expect(opusRest.thinking).toEqual({ type: 'adaptive' })
    expect(opusRest.output_config?.format?.type).toBe('json_schema')
    expect(opusRest.output_config?.effort).toBe('high')
  })

  it('sends two pictures, the last good frame first, as PNG with only the chunks that draw the picture', () => {
    const content = bodyOf('claude-opus-5-5').messages[0]?.content
    const images = Array.isArray(content) ? content.flatMap(block => (block.type === 'image' ? [block] : [])) : []

    expect(images).toHaveLength(2)

    for (const block of images) {
      if (block.source.type !== 'base64') throw new Error('not base64')

      const png = Buffer.from(block.source.data, 'base64')

      expect(block.source.media_type).toBe('image/png')
      expect(chunkTypes(png)).toEqual(['IHDR', 'IDAT', 'IEND'])
      for (const forbidden of ['SIMPLE', 'BITPIX', 'DATE-OBS', 'SITELAT', 'SITELONG', 'OBJCTRA', 'IC 1396']) expect(png.includes(forbidden)).toBe(false)
    }
  })

  it('sends no latitude, longitude, elevation, date, time, FITS header, file name, night or sky position', () => {
    for (const model of ['claude-opus-5-5', 'claude-haiku-5-5']) {
      const text = textOf(model)

      for (const forbidden of ['33.45', '112.07', '331', '2026', '2025', 'DATE-OBS', 'SITELAT', 'SITELONG', 'SITEELEV', 'OBJCTRA', 'OBJCTDEC', 'SIMPLE', 'BITPIX', 'EXTEND', 'Test scope', '21 39', '+57', '.fits', 'night', 'T05:', 'latitude', 'longitude', 'elevation']) {
        expect(text.toLowerCase().includes(forbidden.toLowerCase()) ? forbidden : undefined).toBeUndefined()
      }
    }
  })

  it('sends only the facts it names: the target, exposure, filter, stats, pointing in altitude and azimuth, and events', () => {
    const content = bodyOf('claude-opus-5-5').messages[0]?.content
    const last = Array.isArray(content) ? content.at(-1) : undefined
    const sent = last?.type === 'text' ? (JSON.parse(last.text.slice(last.text.indexOf('\n') + 1)) as Record<string, unknown>) : undefined

    expect(Object.keys(sent ?? {}).sort()).toEqual(['baseline', 'current', 'events', 'exposureSeconds', 'filter', 'lastGood', 'reasons', 'target', 'trend'])
    expect(Object.keys((sent?.['current'] ?? {}) as object).sort()).toEqual(['altitudeDegrees', 'azimuthDegrees', 'elongation', 'hfdPixels', 'minutes', 'noise', 'sky', 'stars'])
    expect(Object.keys(((sent?.['events'] as ReadonlyArray<object>)[0] ?? {}) as object).sort()).toEqual(['event', 'minutes'])
  })
})
