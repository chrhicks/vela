import { describe, expect, it } from 'vitest'
import { makePreviewRgb } from '../frames/preview.ts'
import { syntheticFits } from '../testing/fits.ts'
import { pictureFor } from './image.ts'
import { messageParams, questionOf, type ReviewRequest } from './request.ts'
import { decodeConfig } from '../config.ts'
import { ReviewSettings } from './settings.ts'

const phoenix = { latitude: 33.45, longitude: -112.07, elevation: 331 }

const frameWithHeaders = (seed: number) =>
  syntheticFits({
    width: 64,
    height: 48,
    pattern: 'RGGB',
    pixel: (x, y) => 1000 + ((x * 7 + y * 13 + seed) % 11) * 30 + (x === 20 && y === 20 ? 30000 : 0),
    extra: { 'DATE-OBS': '2026-11-18T05:12:09', SITELAT: phoenix.latitude, SITELONG: phoenix.longitude, SITEELEV: phoenix.elevation, OBJCTRA: '21 39 06', OBJCTDEC: '+57 29 20', OBJECT: 'IC 1396', TELESCOP: 'Test scope' },
  })

const picture = pictureFor(makePreviewRgb(frameWithHeaders(1), { bin: 1, blackSigmas: 2.8, targetMedian: 0.25 }), 1568, 4_500_000)

const request: ReviewRequest = { picture, exposureSeconds: 120 }

const line = { centreDegrees: 3, lowestDegrees: 1.9, heightDegrees: 2.2, source: 'solve' } as const

const lineRequest: ReviewRequest = { ...request, line }

const base = 'Here is an image of a 120 s astrophotography exposure. Please say, with a confidence float from 0 to 1, whether it is obstructed. Known hazards to appear during an observation session: trees, high-tension power poles/lines, houses, clouds obstructing stars.'

const sentence = 'The frame\'s centre is 3 degrees above the mapped tree line in its direction, and the frame is about 2.2 degrees tall.'

const settings = decodeConfig(ReviewSettings, {})

const chunkTypes = (png: Buffer) => {
  const types: string[] = []

  for (let at = 8; at + 12 <= png.length; at += 12 + png.readUInt32BE(at)) types.push(png.toString('latin1', at + 4, at + 8))

  return types
}

const bodyOf = (model: string) => messageParams(settings, model, request)

const contentOf = (model: string, asked: ReviewRequest = request) => {
  const content = messageParams(settings, model, asked).messages[0]?.content

  return Array.isArray(content) ? content : []
}

describe('what an ask sends', () => {
  it('asks each model the same request, naming the model, with adaptive thinking, low effort and a structured answer', () => {
    const { model: opus, ...opusRest } = bodyOf('claude-opus-5-5')
    const { model: haiku, ...haikuRest } = bodyOf('claude-haiku-5-5')

    expect([opus, haiku]).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(opusRest).toEqual(haikuRest)
    expect(opusRest.thinking).toEqual({ type: 'adaptive' })
    expect(opusRest.output_config?.format?.type).toBe('json_schema')
    expect(opusRest.output_config?.effort).toBe('low')
    expect(opusRest.system).toBeUndefined()
  })

  it('is exactly one picture and the question: one message with an image block then a text block', () => {
    const body = bodyOf('claude-opus-5-5')

    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.role).toBe('user')
    expect(contentOf('claude-opus-5-5').map(block => block.type)).toEqual(['image', 'text'])
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config', 'thinking'])
  })

  it('asks in Chris\'s words, with the exposure and the configured hazards', () => {
    const text = contentOf('claude-opus-5-5')[1]

    expect(text).toEqual({ type: 'text', text: base })
    expect(questionOf(60, ['trees', 'the neighbour\'s roof'])).toContain('a 60 s astrophotography exposure')
    expect(questionOf(60, ['trees', 'the neighbour\'s roof'])).toContain('hazards to appear during an observation session: trees, the neighbour\'s roof.')
  })

  it('sends the picture as PNG with only the chunks that draw it and no FITS header text', () => {
    const block = contentOf('claude-opus-5-5')[0]

    if (block?.type !== 'image' || block.source.type !== 'base64') throw new Error('not a base64 image')

    const png = Buffer.from(block.source.data, 'base64')

    expect(block.source.media_type).toBe('image/png')
    expect(chunkTypes(png)).toEqual(['IHDR', 'IDAT', 'IEND'])
    for (const forbidden of ['SIMPLE', 'BITPIX', 'DATE-OBS', 'SITELAT', 'SITELONG', 'OBJCTRA', 'IC 1396']) expect(png.includes(forbidden)).toBe(false)
  })

  it('sends no latitude, longitude, elevation, date, time, FITS header, file name, night, target or sky position', () => {
    for (const model of ['claude-opus-5-5', 'claude-haiku-5-5']) {
      const text = JSON.stringify(contentOf(model).filter(block => block.type === 'text'))

      for (const forbidden of ['33.45', '112.07', '331', '2026', '2025', 'DATE-OBS', 'SITELAT', 'SITELONG', 'SITEELEV', 'OBJCTRA', 'OBJCTDEC', 'SIMPLE', 'BITPIX', 'Test scope', 'IC 1396', '21 39', '+57', '.fits', 'night', 'T05:', 'latitude', 'longitude', 'elevation', 'altitude', 'azimuth']) {
        expect(text.toLowerCase().includes(forbidden.toLowerCase()) ? forbidden : undefined).toBeUndefined()
      }
    }
  })

  it('adds exactly one sentence, the frame against the mapped line, when the line is known, and nothing else changes', () => {
    const plain = contentOf('claude-opus-5-5')
    const placed = contentOf('claude-opus-5-5', lineRequest)

    expect(placed[1]).toEqual({ type: 'text', text: `${base} ${sentence}` })
    expect(placed[0]).toEqual(plain[0])
    expect(placed).toHaveLength(2)
    expect(questionOf(120, ['trees'], line).split('. ').length).toBe(questionOf(120, ['trees']).split('. ').length + 1)
    expect(messageParams(settings, 'claude-opus-5-5', lineRequest)).toEqual({ ...messageParams(settings, 'claude-opus-5-5', request), messages: [{ role: 'user', content: placed }] })
  })

  it('asks as it always did when the line is not known', () => {
    expect(contentOf('claude-opus-5-5', { ...request })[1]).toEqual({ type: 'text', text: base })
    expect(Object.keys(request).sort()).toEqual(['exposureSeconds', 'picture'])
  })

  it('still sends no latitude, longitude, elevation, date, time, FITS header, file name, night, target, sky position, altitude, azimuth or the line\'s own height with the sentence in', () => {
    for (const asked of [lineRequest, { ...lineRequest, line: { ...line, centreDegrees: -4.5, heightDegrees: 3.4 } }]) {
      const text = JSON.stringify(contentOf('claude-opus-5-5', asked).filter(block => block.type === 'text'))
      const numbers = text.match(/\d+(\.\d+)?/g) ?? []

      expect(numbers).toEqual(['120', '0', '1', String(Math.abs(asked.line?.centreDegrees ?? NaN)), String(asked.line?.heightDegrees)])

      for (const forbidden of ['33.45', '112.07', '331', '2026', '2025', 'DATE-OBS', 'SITELAT', 'OBJCTRA', 'IC 1396', '.fits', 'night', 'latitude', 'longitude', 'elevation', 'altitude', 'azimuth', 'solve', 'mount', '1.9']) {
        expect(text.toLowerCase().includes(forbidden.toLowerCase()) ? forbidden : undefined).toBeUndefined()
      }
    }
  })

  it('offers the configured hazards, none and other as the only hazards in the answer format', () => {
    const format = messageParams({ ...settings, hazards: ['trees', 'the neighbour\'s roof'] }, 'claude-opus-5-5', request).output_config?.format

    expect(JSON.stringify(format)).toContain(JSON.stringify(['trees', 'the neighbour\'s roof', 'none', 'other']))
    expect(Object.keys((format?.schema['properties'] ?? {}) as object).sort()).toEqual(['confidence', 'hazard', 'obstructed', 'what'])
  })
})
