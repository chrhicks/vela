import { describe, expect, it } from 'vitest'
import { makeMeasureRequests, measuredOf, measureSubject } from './rig.ts'

const answer = (body: Record<string, unknown>) => ({ id: 'client:1', kind: 'client.measure', at: 1, run: 'rig-run', body })

describe("asking the rig program to measure a frame, and reading its answer", () => {
  it('asks to measure and remove one frame', () => {
    const sent: Array<[string, unknown]> = []
    const request = makeMeasureRequests({ publish: (subject, payload) => void sent.push([subject, JSON.parse(payload)]), newId: () => 'vela-1', by: 'vela' })

    request('polar-align_light_013.fits', ['solve'])

    expect(sent).toEqual([[measureSubject, { id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', measure: ['solve'], remove: true }]])
  })

  it('reads a solve and the header cards', () => {
    expect(measuredOf(answer({ id: 'vela-1', by: 'vela', file: 'a_001.fits', result: 'measured', seconds: 0.39, solve: { solved: true, raDegrees: 340.5, decDegrees: 79.6, wcs: { CROTA2: -69.3 } }, header: { 'DATE-OBS': '2026-11-08T03:30:00.000', EXPTIME: 2, BAD: { x: 1 } }, remove: 'after this entry' }), 'vela')).toEqual({
      file: 'a_001.fits',
      result: 'measured',
      solve: { solved: true, raDegrees: 340.5, decDegrees: 79.6 },
      stars: undefined,
      header: { 'DATE-OBS': '2026-11-08T03:30:00.000', EXPTIME: 2 },
    })
  })

  it('reads a frame that did not solve, star sizes, and a refusal', () => {
    expect(measuredOf(answer({ by: 'vela', file: 'a_001.fits', result: 'measured', solve: { solved: false, reason: 'Not enough stars.' }, header: {} }), 'vela')).toMatchObject({ solve: { solved: false, reason: 'Not enough stars.' } })
    expect(measuredOf(answer({ by: 'vela', file: 'a_001.fits', result: 'measured', stars: { measured: true, hfd: 3.2, count: 488 }, header: {} }), 'vela')).toMatchObject({ stars: { measured: true, hfd: 3.2, count: 488 } })
    expect(measuredOf(answer({ by: 'vela', file: 'a_001.fits', result: 'refused', reason: 'a_001.fits is not in the measure folder' }), 'vela')).toEqual({ file: 'a_001.fits', result: 'refused', reason: 'a_001.fits is not in the measure folder' })
  })

  it('ignores answers to other programs, a frame that could not be removed, and other entries', () => {
    expect(measuredOf(answer({ by: 'observer', file: 'a_001.fits', result: 'measured', header: {} }), 'vela')).toBeUndefined()
    expect(measuredOf(answer({ by: 'vela', file: 'a_001.fits', result: 'not removed', reason: 'EACCES' }), 'vela')).toBeUndefined()
    expect(measuredOf({ id: 'x', kind: 'client.command', at: 1, run: 'r', body: { by: 'vela', file: 'a_001.fits', result: 'measured' } }, 'vela')).toBeUndefined()
  })
})
