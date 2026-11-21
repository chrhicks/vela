import { describe, expect, it } from 'vitest'
import { endsBy } from './ends-by.ts'
import type { Placement } from './targets.ts'

const now = Date.UTC(2026, 10, 11, 6, 33, 0)
const minutes = (count: number) => count * 60_000
const targetLow = now + minutes(210)
const dark = now + minutes(211)
const until = (at: number): Placement['line'] => ({ above: 'until', until: at, lineSource: 'horizon', lineDegrees: 12 })

describe('when a run ends', () => {
  it('with a frame count, ends when the frames are done', () => {
    expect(endsBy({ now, exposureSeconds: 60, frames: 60, line: until(targetLow), darkUntil: dark })).toEqual({ ends: 'at-count', at: now + minutes(60), passes: undefined })
  })

  it('with a frame count, says the first limit the run would pass', () => {
    expect(endsBy({ now, exposureSeconds: 120, frames: 300, line: until(targetLow), darkUntil: dark })).toEqual({ ends: 'at-count', at: now + minutes(600), passes: { by: 'target-low', at: targetLow } })
    expect(endsBy({ now, exposureSeconds: 120, frames: 300, line: { above: 'always' }, darkUntil: dark })).toMatchObject({ passes: { by: 'dark', at: dark } })
  })

  it('with no count, ends at whichever comes first, the target going low or the dark ending', () => {
    expect(endsBy({ now, exposureSeconds: 60, frames: undefined, line: until(targetLow), darkUntil: dark })).toEqual({ ends: 'at-limit', limit: { by: 'target-low', at: targetLow } })
    expect(endsBy({ now, exposureSeconds: 60, frames: undefined, line: until(dark + 1), darkUntil: dark })).toEqual({ ends: 'at-limit', limit: { by: 'dark', at: dark } })
    expect(endsBy({ now, exposureSeconds: 60, frames: undefined, line: { above: 'always' }, darkUntil: dark })).toEqual({ ends: 'at-limit', limit: { by: 'dark', at: dark } })
  })

  it('counts a target that is not up as low now', () => {
    expect(endsBy({ now, exposureSeconds: 60, frames: undefined, line: { above: 'no' }, darkUntil: dark })).toEqual({ ends: 'at-limit', limit: { by: 'target-low', at: now } })
    expect(endsBy({ now, exposureSeconds: 60, frames: 10, line: { above: 'no' }, darkUntil: dark })).toMatchObject({ passes: { by: 'target-low', at: now } })
  })

  it('is unknown with no count while neither the target nor the dark hours are known', () => {
    expect(endsBy({ now, exposureSeconds: 60, frames: undefined, line: undefined, darkUntil: undefined })).toEqual({ ends: 'unknown' })
  })
})
