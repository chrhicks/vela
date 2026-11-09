import { describe, expect, it } from 'vitest'
import { makeNamer } from './names.ts'

describe('naming each frame', () => {
  it('numbers on from the highest frame of the sequence kept tonight', async () => {
    const next = makeNamer({ night: () => '2026-11-09', kept: async () => ['autofocus_light_001.fits', 'autofocus_light_005.fits', 'autofocus_light_005.fits.json', 'M-31_light_009.fits'] })

    expect(await next('autofocus_light')).toBe('autofocus_light_006')
    expect(await next('autofocus_light')).toBe('autofocus_light_007')
    expect(await next('M-31_light')).toBe('M-31_light_010')
  })

  it('starts at 001 on a night with nothing kept, even when the folder is not there yet', async () => {
    const next = makeNamer({ night: () => '2026-11-10', kept: async () => Promise.reject(new Error('ENOENT')) })

    expect(await next('M-31_light')).toBe('M-31_light_001')
    expect(await next('M-31_light')).toBe('M-31_light_002')
  })
})
