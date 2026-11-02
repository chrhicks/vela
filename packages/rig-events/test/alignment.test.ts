import { describe, expect, it } from 'vitest'
import { decodeLine, encodeEvent, seal } from '@vela/rig-events'
import { syntheticSite } from '@vela/rig-testing'
import { alignmentEvents, frameDraft, runDraft } from './alignment-sample.ts'

const goldens = [
  '{"at":1792000000000,"body":{"cameraId":"camera","cameraName":"Test camera","exposureSeconds":2,"folder":"2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8-aBcDeF","mode":"offline","n":1,"rigName":"Test rig","runId":"2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8","simulator":{"at":"2026-10-26T23:38:00.000Z","latitudeDegrees":40,"siderealTimeDegrees":211.75},"telescopeId":"mount","type":"run"},"id":"alignment:2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8:1","kind":"alignment","rig":"test-rig","seenAt":1792000000000,"source":"vela:alignment","v":1}',
  '{"at":1792000000001,"body":{"capture":{"capturedAt":"2026-10-26T23:38:35.936Z","capturedAtSource":"camera","color":{"kind":"mono"},"height":48,"width":64},"evidence":{"fieldHeightDegrees":2.5,"hint":{"decDegrees":10.2,"raDegrees":91.4},"phase":"baseline","physical":{"after":{"coordinateSystem":"topocentric","declinationDegrees":10.25,"observedAt":"2026-10-26T23:38:36.000Z","parked":false,"rightAscensionDegrees":91.5,"slewing":false,"tracking":true},"before":{"coordinateSystem":"topocentric","declinationDegrees":10.25,"observedAt":"2026-10-26T23:38:36.000Z","parked":false,"rightAscensionDegrees":91.5,"slewing":false,"tracking":true},"camera":{"binX":1,"binY":1,"cameraName":"Test camera","height":48,"pixelHeightMicrons":3.76,"pixelWidthMicrons":3.76,"sensorHeightPixels":48,"sensorWidthPixels":64,"startX":0,"startY":0,"width":64}},"position":1,"sample":{"capturedAt":"2026-10-26T23:38:36.936Z","decDegrees":10.25,"raDegrees":91.5},"solution":{"capturedAt":"2026-10-26T23:38:35.936Z","decDegrees":10.25,"raDegrees":91.5,"wcs":{"cd":[-0.0000052,0.000535,-0.000535,-0.0000056],"decDegrees":10.25,"height":48,"raDegrees":91.5,"referenceX":32.5,"referenceY":24.5,"width":64}}},"n":2,"original":{"bytes":2880,"filename":"baseline-11111111-1111-4111-8111-111111111111.fits","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"runId":"2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8","type":"frame"},"id":"alignment:2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8:2","kind":"alignment","rig":"test-rig","seenAt":1792000000001,"source":"vela:alignment","v":1}',
]

describe('the alignment event', () => {
  it.each([
    ['an offline run', 0],
    ['a physical frame', 1],
  ])('writes %s as exactly this line, and reads it back', (_name, index) => {
    expect(encodeEvent(alignmentEvents[index]!)).toBe(goldens[index])
    expect(decodeLine(goldens[index]!)).toEqual({ ok: true, event: alignmentEvents[index] })
  })

  it('has the id alignment:<run id>:<n>, so a trial entry filed twice is one event', () => {
    expect(alignmentEvents.map(event => event.id)).toEqual([
      'alignment:2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8:1',
      'alignment:2bfbf00c-acf2-4bf2-9ee3-09a08615b7b8:2',
    ])
    expect(seal({ ...frameDraft, at: runDraft.at, seenAt: runDraft.at }).id).toBe(alignmentEvents[1]!.id)
  })

  it('drops every site field and sidereal time from a body that carries them', () => {
    const body = JSON.parse(goldens[1]!)
    const { physical } = body.body.evidence

    body.body.evidence.physical = { ...physical, site: syntheticSite }
    body.body.evidence.sample.siderealTimeDegrees = 211.75
    physical.before.latitudeDegrees = syntheticSite.latitudeDegrees
    physical.before.longitudeDegrees = syntheticSite.longitudeDegrees
    physical.before.elevationMeters = syntheticSite.elevationMeters

    const decoded = decodeLine(JSON.stringify(body))

    expect(decoded.ok && encodeEvent(decoded.event)).toBe(goldens[1])
  })

  it('refuses an entry numbered below 1 and an offline run with no simulator', () => {
    const numbered = JSON.parse(goldens[0]!)
    const bare = JSON.parse(goldens[0]!)

    numbered.body.n = 0
    delete bare.body.simulator

    expect(decodeLine(JSON.stringify(numbered)).ok).toBe(false)
    expect(decodeLine(JSON.stringify(bare)).ok).toBe(false)
  })
})
