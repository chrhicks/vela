import { describe, expect, it } from 'vitest'
import { guiding, unknownGuiding, type Guiding } from './guiding.ts'
import { entry, fold } from './testing.ts'

const guider = (event: string, at: number, extra: Readonly<Record<string, unknown>> = {}) => entry(`phd2.${event}`, at, { Event: event, Timestamp: at / 1000, ...extra })

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Guiding>(guiding, unknownGuiding, entries)

describe('guiding', () => {
  it("keeps PHD2's own smoothed guide error while it guides", () => {
    expect(reduce([guider('StartGuiding', 1), guider('GuideStep', 2, { AvgDist: 0.16, RADistanceRaw: 0.18 })])).toEqual({ link: 'connected', activity: 'guiding', averagePixels: 0.16, at: 2 })
  })

  it('says when the star is lost or guiding stops, and drops the guide error then', () => {
    expect(reduce([guider('GuideStep', 1, { AvgDist: 0.2 }), guider('StarLost', 2)])).toEqual({ link: 'connected', activity: 'starLost', averagePixels: undefined, at: 2 })
    expect(reduce([guider('GuideStep', 1, { AvgDist: 0.2 }), guider('GuidingStopped', 2)])).toMatchObject({ activity: 'stopped' })
  })

  it('follows the link to PHD2 and starts over when the rig program reconnects', () => {
    const state = reduce([guider('GuideStep', 1, { AvgDist: 0.2 })])

    expect(fold(guiding, state, [entry('client.connection', 2, { target: 'phd2', status: 'closed' })])).toEqual({ link: 'closed' })
    expect(fold(guiding, state, [entry('client.connected', 2, { run: 'r2' })])).toEqual(unknownGuiding)
    expect(fold(guiding, state, [entry('client.connection', 2, { target: 'indiserver', status: 'closed' })])).toBe(state)
  })

  it('leaves out PHD2 events it does not use', () => {
    expect(reduce([entry('phd2.Version', 1, { Event: 'Version', PHDVersion: '2.6.13' })])).toBe(unknownGuiding)
  })
})
