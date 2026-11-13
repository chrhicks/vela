import { Result, Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { Bootstrap, FeedEntry, entryOfFeed, StartToken } from './feed.ts'
import { emptyRig } from './rig.ts'
import { entry, foldRig, frameKept, frameMeasured, runStarted } from './testing.ts'

const overTheWire = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('the feed messages', () => {
  it('decode the state the service sends back to the same state', () => {
    const state = foldRig([runStarted('r1', 1000), frameKept('m31_001.fits', 2000), frameKept('m31_002.fits', 3000), frameMeasured('m31_001.fits', 2001, {})])
    const decoded = Schema.decodeUnknownSync(Bootstrap)(overTheWire({ token: StartToken.make('1794500000000'), at: 4000, night: '2026-11-08', limits: { heartbeatSeconds: 5, lostAfterSeconds: 15, rigSilentAfterSeconds: 10 }, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50], autofocusExposureSeconds: { in: 10, out: 2 }, coolerCelsius: -10, testFrameSeconds: 2 }, state }))

    expect(decoded.state).toEqual(state)
  })

  it('decode the empty state of a service that has read nothing', () => {
    expect(Schema.decodeUnknownSync(Bootstrap)(overTheWire({ token: '1', at: 1, night: '2026-11-08', limits: { heartbeatSeconds: 5, lostAfterSeconds: 15, rigSilentAfterSeconds: 10 }, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50], autofocusExposureSeconds: { in: 10, out: 2 }, coolerCelsius: -10, testFrameSeconds: 2 }, state: emptyRig })).state).toEqual({ frames: [], readings: {}, devices: { mount: {}, primary: {}, focuser: {}, box: {}, guide: {} }, guiding: { link: 'unknown' }, trends: { hfd: [], stars: [], guideRa: [], guideDec: [], airTemperature: [], focuserTemperature: [], humidity: [], dewHeaters: {} }, writes: {}, operations: {}, alignment: { errors: [] }, autofocus: { positions: [], samples: [] } })
  })

  it('decode an entry, and refuse one without a stream position', () => {
    const sent = entry('phd2.GuideStep', 5, { Frame: 1 })

    expect(entryOfFeed(Schema.decodeUnknownSync(FeedEntry)(overTheWire(sent)))).toEqual(sent)
    expect(Result.isFailure(Schema.decodeUnknownResult(FeedEntry)({ kind: 'x', at: 1 }))).toBe(true)
  })
})
