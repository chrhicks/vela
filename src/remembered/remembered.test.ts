import { describe, expect, it } from 'vitest'
import { entry } from '../../state/testing.ts'
import { lastCentreNear, nothingRemembered, remember } from './remembered.ts'

const fold = (entries: ReadonlyArray<ReturnType<typeof entry>>) => entries.reduce(remember, nothingRemembered)

const light = (at: number, run: string, exposureSeconds: number, count?: number) => entry('vela.run.started', at, { run, object: 'NGC 7635', frameType: 'light', exposureSeconds, ...(count === undefined ? {} : { count }) })
const pass = (at: number, run: string, raDegrees: number, decDegrees: number, rotationDegrees?: number) =>
  entry('vela.centre.pass', at, { run, frame: 1, solved: true, raDegrees, decDegrees, ...(rotationDegrees === undefined ? {} : { rotationDegrees }) })
const ended = (at: number, run: string, reason: string) => entry('vela.run.ended', at, { run, reason })

describe('what Vela remembers from the stream', () => {
  it('keeps the exposure and count of the last light run on a target, whatever order the entries come in', () => {
    const inOrder = fold([light(100, 'a', 60, 300), light(200, 'b', 120)])
    const replayed = fold([light(200, 'b', 120), light(100, 'a', 60, 300)])

    expect(inOrder.lastLight).toEqual({ exposureSeconds: 120, frames: undefined, at: 200 })
    expect(replayed.lastLight).toEqual(inOrder.lastLight)
  })

  it('does not count a centring, focus or calibration run as the last light run', () => {
    const state = fold([
      light(100, 'a', 60, 300),
      entry('vela.run.started', 200, { run: 'c', object: 'centre', frameType: 'light', exposureSeconds: 2 }),
      entry('vela.run.started', 300, { run: 'd', object: 'dark', frameType: 'dark', exposureSeconds: 120, count: 30 }),
    ])

    expect(state.lastLight).toMatchObject({ exposureSeconds: 60, frames: 300 })
  })

  it('keeps the camera angle of the latest solve that gave one', () => {
    const state = fold([pass(100, 'c1', 350, 61, 109.3), pass(200, 'c2', 83, -5, 109.4), pass(300, 'c3', 83, -5)])

    expect(state.cameraAngle).toEqual({ degrees: 109.4, at: 200 })
  })

  it('finds the last centre reached near a position, and not one from a centring that was stopped', () => {
    const state = fold([
      pass(100, 'c1', 349.2, 61.0),
      pass(110, 'c1', 349.735, 61.561),
      ended(111, 'c1', 'done'),
      pass(500, 'c2', 349.9, 61.3),
      ended(501, 'c2', 'stopped'),
      pass(600, 'c3', 83.8, -5.4),
      ended(601, 'c3', 'done'),
    ])
    const bubble = { raDegrees: 350.2, decDegrees: 61.2 }

    expect(lastCentreNear(state, bubble, 1.1)).toMatchObject({ run: 'c1', raDegrees: 349.735, decDegrees: 61.561, at: 110 })
    expect(lastCentreNear(state, { raDegrees: 10.7, decDegrees: 41.3 }, 1.1)).toBeUndefined()
  })
})
