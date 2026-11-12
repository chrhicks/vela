import { describe, expect, it } from 'vitest'
import { frameEntry } from './entry.ts'

describe('frameEntry', () => {
  it('carries the file, night, size and hash in the stream envelope', () => {
    const entry = frameEntry({ file: 'a_001.fits', night: '2026-11-07', bytes: 10, sha256: 'ab' }, 'rig-x', 5)

    expect(entry).toEqual({ v: 2, id: 'vela.frame:2026-11-07:a_001.fits', rig: 'rig-x', kind: 'vela.frame', at: 5, source: 'vela', body: { file: 'a_001.fits', night: '2026-11-07', bytes: 10, sha256: 'ab' } })
  })
})
