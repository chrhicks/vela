import { StreamPosition } from '../../state/entry.ts'
import { describe, expect, it } from 'vitest'
import { makeMeasureRequests, measuredOf, notKeptOf } from './rig.ts'

const answer = (body: Record<string, unknown>) => ({ seq: StreamPosition.make(0), kind: 'client.measure', at: 1, body })

describe("asking the rig program to measure a frame, and reading its answer", () => {
  it('asks to measure and remove one frame', () => {
    const sent: Array<[string, unknown]> = []
    const request = makeMeasureRequests({ subject: 'rig-test.command.measure', publish: (subject, payload) => void sent.push([subject, JSON.parse(payload)]), newId: () => 'vela-1', by: 'vela' })

    request('polar-align_light_013.fits', ['solve'])

    expect(sent).toEqual([['rig-test.command.measure', { id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', measure: ['solve'], remove: true }]])
  })

  it('reads a solve and the header cards', () => {
    expect(measuredOf(answer({ id: 'vela-1', by: 'vela', file: 'a_001.fits', result: 'measured', seconds: 0.39, solve: { solved: true, raDegrees: 340.5, decDegrees: 79.6, wcs: { CROTA2: -69.3 } }, header: { 'DATE-OBS': '2026-11-08T03:30:00.000', EXPTIME: 2, BAD: { x: 1 } }, remove: 'after this entry' }), 'vela')).toEqual({
      file: 'a_001.fits',
      result: 'measured',
      solve: { solved: true, raDegrees: 340.5, decDegrees: 79.6, rotationDegrees: -69.3 },
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
    expect(measuredOf({ seq: StreamPosition.make(0), kind: 'client.command', at: 1, body: { by: 'vela', file: 'a_001.fits', result: 'measured' } }, 'vela')).toBeUndefined()
  })
})

describe('asking to keep a measured frame', () => {
  it('asks to keep the frame, not to remove it', () => {
    const sent: Array<unknown> = []
    const request = makeMeasureRequests({ subject: 'rig-test.command.measure', publish: (_subject, payload) => void sent.push(JSON.parse(payload)), newId: () => 'vela-1', by: 'vela' })

    request('horizon-sweep_light_001.fits', ['solve', 'stars'], true)
    request('polar-align_light_013.fits', ['solve'], false)

    expect(sent).toEqual([
      { id: 'vela-1', by: 'vela', file: 'horizon-sweep_light_001.fits', measure: ['solve', 'stars'], remove: false, keep: true },
      { id: 'vela-1', by: 'vela', file: 'polar-align_light_013.fits', measure: ['solve'], remove: true },
    ])
  })

  it('reads the scale of a solve, and a frame the rig program could not keep', () => {
    expect(measuredOf(answer({ by: 'vela', file: 'a_001.fits', result: 'measured', solve: { solved: true, raDegrees: 1, decDegrees: 2, wcs: { CROTA2: 3, CDELT2: -0.000333 } }, header: {} }), 'vela')).toMatchObject({ solve: { solved: true, rotationDegrees: 3, scaleArcsecPerPixel: 1.1988 } })
    expect(notKeptOf(answer({ by: 'vela', file: 'a_001.fits', result: 'not kept', reason: 'EXDEV' }), 'vela')).toEqual({ file: 'a_001.fits', reason: 'EXDEV' })
    expect(notKeptOf(answer({ by: 'observer', file: 'a_001.fits', result: 'not kept', reason: 'EXDEV' }), 'vela')).toBeUndefined()
    expect(notKeptOf(answer({ by: 'vela', file: 'a_001.fits', result: 'not removed', reason: 'EACCES' }), 'vela')).toBeUndefined()
  })
})
