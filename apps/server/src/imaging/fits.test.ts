import { describe, expect, it } from 'vitest'
import { encodeCaptureFits, type FrameSettings } from './fits.js'
import { readRetainedFits } from './read-retained-fits.js'

const metadata = { exposureSeconds: 1.5, cameraName: "Chris's camera" }

const frame = {
  width: 3,
  height: 2,
  pixels: [-2_147_483_648, -1, 0, 1, 65535, 2_147_483_647],
  capturedAt: '2026-09-05T19:00:00-04:00',
}

function header(buffer: Buffer) {
  return buffer.subarray(0, 2880).toString('ascii').match(/.{80}/g)!
}

describe('original capture FITS', () => {
  it('stores every unsigned 16-bit value losslessly without changing acquisition samples', async () => {
    const pixels = Int32Array.from({ length: 65_536 }, (_, i) => i)
    const original = pixels.slice()
    const fits = await encodeCaptureFits({ ...frame, width: 256, height: 256, pixels }, metadata)
    const cards = header(fits)
    expect(cards[1]).toBe('BITPIX  =                   16'.padEnd(80))
    expect(cards).toContain('BZERO   =                32768'.padEnd(80))
    expect(cards).toContain('BSCALE  =                    1'.padEnd(80))
    expect(
      Array.from({ length: pixels.length }, (_, i) => fits.readInt16BE(2880 + i * 2) + 32_768),
    ).toEqual(Array.from(original))
    expect(pixels).toEqual(original)
    expect(fits.subarray(2880, 2884).toString('hex')).toBe('80008001')
    expect(fits.subarray(2880 + 32_767 * 2, 2880 + 32_769 * 2).toString('hex')).toBe('ffff0000')
    expect(fits.readInt16BE(2880 + 65_535 * 2)).toBe(32_767)
    expect(fits.length).toBe(2880 + Math.ceil((pixels.length * 2) / 2880) * 2880)
    expect(fits.subarray(2880 + pixels.length * 2).every(value => value === 0)).toBe(true)
    expect(cards.slice(cards.indexOf('END'.padEnd(80)) + 1).every(card => card.trim() === '')).toBe(
      true,
    )
  })

  it.each([-1, 65_536])('keeps signed 32-bit storage when a late sample is %s', async value => {
    const pixels = new Int32Array(65_537).fill(32_768)
    pixels[pixels.length - 1] = value
    const original = pixels.slice()

    const fits = await encodeCaptureFits(
      { ...frame, width: pixels.length, height: 1, pixels },
      metadata,
    )

    expect(header(fits)[1]).toBe('BITPIX  =                   32'.padEnd(80))
    expect(header(fits).some(card => /^(BZERO|BSCALE)/.test(card))).toBe(false)
    expect(Array.from({ length: pixels.length }, (_, i) => fits.readInt32BE(2880 + i * 4))).toEqual(
      Array.from(original),
    )
    expect(pixels).toEqual(original)
  })

  it('preserves signed samples in row order and pads header/data to FITS blocks', async () => {
    const fits = await encodeCaptureFits(frame, metadata)
    expect(fits.length).toBe(5760)
    expect(Array.from({ length: 6 }, (_, i) => fits.readInt32BE(2880 + i * 4))).toEqual(
      frame.pixels,
    )
    expect(fits.subarray(2880, 2892).toString('hex')).toBe('80000000ffffffff00000000')
    expect(fits.subarray(2904).every(value => value === 0)).toBe(true)
    const cards = header(fits)
    expect(cards[0]).toBe('SIMPLE  =                    T'.padEnd(80))
    expect(cards[1]).toBe('BITPIX  =                   32'.padEnd(80))
    expect(cards).toContain("DATE-OBS= '2026-09-05T23:00:00.000Z'".padEnd(80))
    expect(cards).toContain('EXPTIME =                  1.5'.padEnd(80))
    expect(cards).toContain("INSTRUME= 'Chris''s camera'".padEnd(80))
    expect(cards).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))
    expect(cards.some(card => card.startsWith('BAYERPAT'))).toBe(false)
    expect(cards.slice(cards.indexOf('END'.padEnd(80)) + 1).every(card => card.trim() === '')).toBe(
      true,
    )
  })

  it.each(['rggb', 'grbg', 'gbrg', 'bggr'] as const)(
    'writes the acquisition-origin %s pattern without another shift',
    async pattern => {
      for (const pixels of [frame.pixels, [0, 1, 32_767, 32_768, 65_534, 65_535]]) {
        const fits = await encodeCaptureFits(
          { ...frame, pixels, color: { kind: 'bayer', pattern } },
          metadata,
        )

        expect(header(fits)).toContain(`BAYERPAT= '${pattern.toUpperCase()}'`.padEnd(80))
        expect(header(fits)).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))
      }
    },
  )

  it('keeps long camera labels on one card and rejects lossy pixel conversion', async () => {
    const fits = await encodeCaptureFits(frame, { ...metadata, cameraName: "é'".repeat(100) })
    expect(
      header(fits)
        .find(card => card.startsWith('INSTRUME'))!
        .trimEnd()
        .endsWith("'"),
    ).toBe(true)
    expect(header(fits)).toContain("ROWORDER= 'TOP-DOWN'".padEnd(80))

    for (const value of [NaN, Infinity, -Infinity, 0.1, 2_147_483_648, -2_147_483_649]) {
      await expect(
        encodeCaptureFits({ ...frame, pixels: [value, 0, 0, 0, 0, 0] }, metadata),
      ).rejects.toThrow('signed 32-bit')
    }

    await expect(encodeCaptureFits({ ...frame, width: 4 }, metadata)).rejects.toThrow('dimensions')
  })

  it('validates samples beyond an initial batch and after selecting signed storage', async () => {
    const pixels = new Float64Array(65_537)
    pixels[0] = -1
    pixels[pixels.length - 1] = 0.5
    await expect(
      encodeCaptureFits({ ...frame, width: pixels.length, height: 1, pixels }, metadata),
    ).rejects.toThrow('signed 32-bit')
  })

  it.each([0, -1])(
    'yields during validation and writing for a large frame containing %s',
    async value => {
      const pixels = Array.from({ length: 196_608 }, () => value)
      let firstReads = 0
      let lastReads = 0
      let observeWriting: () => void = () => {}

      const writingTick = new Promise<void>(resolve => {
        observeWriting = resolve
      })

      Object.defineProperty(pixels, 0, {
        get() {
          firstReads++

          if (firstReads === 2) setImmediate(observeWriting)

          return value
        },
      })
      Object.defineProperty(pixels, pixels.length - 1, {
        get() {
          lastReads++

          return value
        },
      })
      const validationTick = new Promise<void>(resolve => setImmediate(resolve))
      const pending = encodeCaptureFits({ ...frame, width: 512, height: 384, pixels }, metadata)
      await validationTick
      expect(lastReads).toBe(0)
      await writingTick
      expect(lastReads).toBe(1)
      await pending
      expect(lastReads).toBe(2)
    },
  )
})

it.each([{ pixels: frame.pixels }, { pixels: [0, 1, 32_767, 32_768, 65_534, 65_535] }])(
  'preserves exposure metadata and annotates only estimated starts ($pixels)',
  async ({ pixels }) => {
    for (const capturedAtSource of [undefined, 'camera', 'server-estimate'] as const) {
      const fits = await encodeCaptureFits({ ...frame, pixels, capturedAtSource }, metadata)
      const header = fits.toString('ascii', 0, 2880)
      expect(header).toContain("DATE-OBS= '2026-09-05T23:00:00.000Z'")
      expect(header).toContain('EXPTIME =                  1.5')
      expect(header).toContain("INSTRUME= 'Chris''s camera'")
      expect(header.includes("TIMESRC = 'SERVER-ESTIMATE'")).toBe(
        capturedAtSource === 'server-estimate',
      )
      expect(
        header.includes('COMMENT DATE-OBS estimated from server UTC before StartExposure.'),
      ).toBe(capturedAtSource === 'server-estimate')
    }
  },
)

describe('IMAGETYP', () => {
  it.each([
    ['light', 'LIGHT'],
    ['dark', 'DARK'],
    ['flat', 'FLAT'],
    ['dark-flat', 'DARKFLAT'],
    ['bias', 'BIAS'],
  ] as const)('writes %s as %s', async (frameType, keyword) => {
    const fits = await encodeCaptureFits(frame, { ...metadata, frameType })
    expect(header(fits)).toContain(`IMAGETYP= '${keyword}'`.padEnd(80))
  })

  it('writes LIGHT when the caller names no type', async () => {
    expect(header(await encodeCaptureFits(frame, metadata))).toContain("IMAGETYP= 'LIGHT'".padEnd(80))
  })
})

describe('camera, optics and target settings', () => {
  const settings: FrameSettings = {
    gain: 100,
    offset: 10,
    binX: 2,
    binY: 2,
    pixelWidthMicrons: 7.52,
    pixelHeightMicrons: 7.52,
    sensorTemperatureC: -10.2,
    setpointC: -10,
    focalLengthMm: 400,
    pierSide: 'west',
  }

  /** Every keyword in the header with its raw value, and whether any keyword repeats. */
  function keywords(fits: Buffer) {
    const cards = header(fits)
      .filter(card => card.trim() !== '' && !card.startsWith('COMMENT'))
      .map(card => ({ key: card.slice(0, 8).trim(), value: card.slice(10).trim() }))

    return {
      values: new Map(cards.map(({ key, value }) => [key, value])),
      repeated: cards.length !== new Set(cards.map(({ key }) => key)).size,
    }
  }

  const baseline = ['SIMPLE', 'BITPIX', 'NAXIS', 'NAXIS1', 'NAXIS2', 'DATE-OBS', 'EXPTIME', 'IMAGETYP', 'INSTRUME', 'ROWORDER', 'END']

  const settingKeys = ['GAIN', 'OFFSET', 'XBINNING', 'YBINNING', 'XPIXSZ', 'YPIXSZ', 'CCD-TEMP', 'SET-TEMP', 'FOCALLEN', 'OBJECT', 'FILTER', 'PIERSIDE']

  it('writes every setting with its value and units on a light frame', async () => {
    const fits = await encodeCaptureFits(frame, { ...metadata, objectName: 'M 31', filterName: 'L-Ultimate', settings })
    const { values } = keywords(fits)

    expect(Object.fromEntries(settingKeys.map(key => [key, values.get(key)]))).toEqual({
      GAIN: '100',
      OFFSET: '10',
      XBINNING: '2',
      YBINNING: '2',
      XPIXSZ: '7.52',
      YPIXSZ: '7.52',
      'CCD-TEMP': '-10.2',
      'SET-TEMP': '-10',
      FOCALLEN: '400',
      OBJECT: "'M 31'",
      FILTER: "'L-Ultimate'",
      PIERSIDE: "'WEST'",
    })

    expect(header(fits)).toContain('CCD-TEMP=                -10.2'.padEnd(80))
    await expect(readRetainedFits(fits)).resolves.toMatchObject({ width: 3, height: 2 })
  })

  it.each(['dark', 'flat', 'dark-flat', 'bias'] as const)('names no object on a %s frame', async frameType => {
    const fits = await encodeCaptureFits(frame, { ...metadata, frameType, objectName: 'M 31', settings })

    expect(keywords(fits).values.has('OBJECT')).toBe(false)
    expect(keywords(fits).values.get('GAIN')).toBe('100')
  })

  it.each(['light', 'flat'] as const)('names the filter on a %s frame', async frameType => {
    const fits = await encodeCaptureFits(frame, { ...metadata, frameType, filterName: 'L-Ultimate', settings })

    expect(keywords(fits).values.get('FILTER')).toBe("'L-Ultimate'")
  })

  it.each(['dark', 'dark-flat', 'bias'] as const)('names no filter on a %s frame', async frameType => {
    const fits = await encodeCaptureFits(frame, { ...metadata, frameType, filterName: 'L-Ultimate', settings })

    expect(keywords(fits).values.has('FILTER')).toBe(false)
  })

  it.each([null, undefined, '  '])('writes no FILTER key, never the word None, for %j', async filterName => {
    const fits = await encodeCaptureFits(frame, { ...metadata, filterName, settings })

    expect(keywords(fits).values.has('FILTER')).toBe(false)
    expect(header(fits).join('')).not.toMatch(/none/i)
  })

  it('names no object on a light frame without a subject', async () => {
    expect(keywords(await encodeCaptureFits(frame, { ...metadata, settings })).values.has('OBJECT')).toBe(false)
  })

  it('leaves out exactly the settings that could not be read, and the file still reads back', async () => {
    const { gain: _gain, binX: _binX, setpointC: _setpoint, pierSide: _pierSide, ...unread } = settings
    const fits = await encodeCaptureFits(frame, { ...metadata, settings: unread })
    const { values } = keywords(fits)

    expect(settingKeys.filter(key => !values.has(key))).toEqual(['GAIN', 'XBINNING', 'SET-TEMP', 'OBJECT', 'FILTER', 'PIERSIDE'])
    expect(values.get('OFFSET')).toBe('10')
    expect((await readRetainedFits(fits)).pixels).toEqual(Int32Array.from(frame.pixels))
  })

  it('writes no setting card when none was read', async () => {
    const withNone = [await encodeCaptureFits(frame, metadata), await encodeCaptureFits(frame, { ...metadata, settings: {} })]

    for (const fits of withNone)
      expect([...keywords(fits).values.keys()]).toEqual(baseline)
  })

  it('leaves out a setting that is not a finite number rather than writing an invalid card', async () => {
    const fits = await encodeCaptureFits(frame, { ...metadata, settings: { gain: NaN, offset: Infinity, binX: 1 } })
    const { values } = keywords(fits)

    expect(values.has('GAIN') || values.has('OFFSET')).toBe(false)
    expect(values.get('XBINNING')).toBe('1')
  })

  it('writes every card as 80 ASCII characters, once, in the first header block, and escapes apostrophes', async () => {
    const fits = await encodeCaptureFits(
      { ...frame, color: { kind: 'bayer', pattern: 'rggb' }, capturedAtSource: 'server-estimate' },
      { ...metadata, objectName: "Barnard's Loop é", settings },
    )

    const cards = header(fits)

    expect(cards.every(card => card.length === 80 && /^[\x20-\x7e]+$/.test(card))).toBe(true)
    expect(keywords(fits).repeated).toBe(false)
    expect(cards).toContain("OBJECT  = 'Barnard''s Loop ?'".padEnd(80))
    expect(cards.indexOf('END'.padEnd(80))).toBeLessThan(36)
  })

  it('keeps every existing card as it was', async () => {
    const without = await encodeCaptureFits(frame, metadata)
    const withSettings = await encodeCaptureFits(frame, { ...metadata, objectName: 'M 31', settings })
    const added = new Set(settingKeys)

    const written = (fits: Buffer) => header(fits).filter(card => card.trim() !== '')

    expect(written(withSettings).filter(card => !added.has(card.slice(0, 8).trim()))).toEqual(written(without))
    expect(withSettings.subarray(2880)).toEqual(without.subarray(2880))
  })

  it('writes no site or pointing key under any input', async () => {
    const hostile = {
      ...settings,
      SITELAT: 1,
      SITELONG: 2,
      LAT: 3,
      LONG: 4,
      ELEVATION: 5,
      latitudeDegrees: 6,
      longitudeDegrees: 7,
      elevationMeters: 8,
      rightAscensionDegrees: 9,
      declinationDegrees: 10,
    }

    const extra = { siteLatitude: 1, ra: 2 }

    const fits = await encodeCaptureFits(
      { ...frame, pixels: [0, 1, 2, 3, 4, 5], color: { kind: 'bayer', pattern: 'rggb' }, capturedAtSource: 'server-estimate' },
      { ...metadata, ...extra, objectName: 'M 31', settings: hostile },
    )

    const written = [...keywords(fits).values.keys()]

    const allowed = [...baseline, 'BZERO', 'BSCALE', 'TIMESRC', 'BAYERPAT', ...settingKeys]

    expect(written.filter(key => !allowed.includes(key))).toEqual([])

    expect(written.filter(key => /^(SITE|LAT|LONG|ELEV|ALT-OBS|OBSGEO|OBJCT|RA|DEC|CRVAL|MNT|TELE?RA|TELEDEC)/.test(key))).toEqual([])
  })
})
