export interface SyntheticFits {
  readonly width: number
  readonly height: number
  readonly pixel: (x: number, y: number) => number
  readonly pattern?: string
  readonly rowOrder?: 'TOP-DOWN'
  readonly bitpix?: number
  readonly extra?: Readonly<Record<string, string | number>>
}

function card(text: string) {
  return text.padEnd(80, ' ')
}

function valueCard(key: string, value: string | number | boolean) {
  const rendered = typeof value === 'string' ? `'${value}'` : typeof value === 'boolean' ? (value ? 'T' : 'F') : String(value)

  return card(`${key.padEnd(8, ' ')}= ${rendered.padStart(20, ' ')} / test`)
}

export function syntheticFits({ width, height, pixel, pattern, rowOrder, bitpix = 16, extra = {} }: SyntheticFits) {
  const cards = [
    valueCard('SIMPLE', true),
    valueCard('BITPIX', bitpix),
    valueCard('NAXIS', 2),
    valueCard('NAXIS1', width),
    valueCard('NAXIS2', height),
    valueCard('EXTEND', true),
    card('COMMENT  FITS (Flexible Image Transport System) format is defined in Astronomy'),
    valueCard('BZERO', 32768),
    valueCard('BSCALE', 1),
    ...(rowOrder === undefined ? [] : [valueCard('ROWORDER', rowOrder)]),
    valueCard('INSTRUME', 'Test Camera'),
    valueCard('EXPTIME', 1),
    ...(pattern === undefined ? [] : [valueCard('XBAYROFF', 0), valueCard('YBAYROFF', 0), valueCard('BAYERPAT', pattern)]),
    ...Object.entries(extra).map(([key, value]) => valueCard(key, value)),
    card('END'),
  ]

  const header = Buffer.from(cards.join('').padEnd(Math.ceil((cards.length * 80) / 2880) * 2880, ' '), 'latin1')
  const data = Buffer.alloc(Math.ceil((width * height * 2) / 2880) * 2880)

  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.writeInt16BE(pixel(x, y) - 32768, (y * width + x) * 2)

  return Buffer.concat([header, data])
}
