import { describe, expect, it } from 'vitest'
import { findRow, searchCatalog } from './search.ts'
import { parsePosition, positionName } from './position.ts'

const ra = (hours: number, minutes: number, seconds: number) => (hours + minutes / 60 + seconds / 3600) * 15
const dec = (degrees: number, minutes: number, seconds: number) => Math.sign(degrees || 1) * (Math.abs(degrees) + minutes / 60 + seconds / 3600)

describe('a typed J2000 position', () => {
  it.each([
    ['23h18m56s +61d33m37s', ra(23, 18, 56), dec(61, 33, 37)],
    ['23:18:56 +61:33:37', ra(23, 18, 56), dec(61, 33, 37)],
    ['23 18 56.5 61 33 37', ra(23, 18, 56.5), dec(61, 33, 37)],
    ["05h35m17s -05°23′28″", ra(5, 35, 17), -dec(5, 23, 28)],
    ['12 00 00 -00 30 00', 180, -0.5],
    ['349.73 61.56', 349.73, 61.56],
    ['23.3h 61.5', 23.3 * 15, 61.5],
  ])('reads %s', (text, raDegrees, decDegrees) => {
    const position = parsePosition(text)

    expect(position?.raDegrees).toBeCloseTo(raDegrees, 9)
    expect(position?.decDegrees).toBeCloseTo(decDegrees, 9)
  })

  it.each(['M 31', 'NGC 7000', '31', '23 61 +61 70 00 00', '400 10', '10 95', ''])('is not a position: %s', text => {
    expect(parsePosition(text)).toBeUndefined()
  })

  it('is named in hours and degrees', () => {
    expect(positionName({ raDegrees: ra(23, 18, 56), decDegrees: dec(61, 33, 37) })).toBe('23h18m56s +61°33′37″')
    expect(positionName({ raDegrees: ra(5, 35, 17), decDegrees: -dec(0, 23, 28) })).toBe('05h35m17s -00°23′28″')
  })

  it('is the one search result, and its id finds the same position again', () => {
    const [found] = searchCatalog('23h18m56s +61d33m37s', 10)
    const row = findRow(found!.id)

    expect(found).toMatchObject({ name: '23h18m56s +61°33′37″', type: 'J2000 position' })
    expect(row?.[4]).toBeCloseTo(ra(23, 18, 56), 5)
    expect(row?.[5]).toBeCloseTo(dec(61, 33, 37), 5)
  })

  it('leaves catalog searches alone', () => {
    expect(searchCatalog('M 31', 1)[0]?.id).toBe('ngc0224')
  })
})
