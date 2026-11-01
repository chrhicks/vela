import { describe, expect, it } from 'vitest'
import { epochMs } from '@vela/rig-events'
import { nightOf } from '@vela/rig-frames'

const at = (text: string) => epochMs(Date.parse(text))

describe('nightOf', () => {
  it('names an evening session and the small hours after it with one date', () => {
    expect(nightOf(at('2026-10-26T23:38:00Z'), 0)).toBe('2026-10-26')
    expect(nightOf(at('2026-10-27T03:00:00Z'), 0)).toBe('2026-10-26')
    expect(nightOf(at('2026-10-27T11:59:59Z'), 0)).toBe('2026-10-26')
    expect(nightOf(at('2026-10-27T12:00:00Z'), 0)).toBe('2026-10-27')
  })

  it('moves the noon boundary with the site offset', () => {
    const lateNight = at('2026-10-27T12:30:00Z')

    expect(nightOf(lateNight, 0)).toBe('2026-10-27')
    expect(nightOf(lateNight, -7 * 60)).toBe('2026-10-26')
  })
})
