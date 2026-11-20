import { describe, expect, it, vi } from 'vitest'
import type { Measured } from '../measure/rig.ts'
import { fakeCamera } from '../testing/camera.ts'
import { makeSweepFrames } from './frames.ts'

function setup(exposures: Array<'file' | 'alert'> = []) {
  const camera = fakeCamera({ exposures })
  const kept: Array<boolean> = []
  const labels: Array<{ readonly file: string; readonly keep: boolean | undefined; readonly measure: ReadonlyArray<string> | undefined; readonly frame: number }> = []
  const frames = makeSweepFrames({
    picture: camera.picture,
    capture: { start: (request, between, measure, keep) => camera.capture.start(request, between, measure, keep), labelOf: camera.capture.labelOf, stop: () => camera.capture.stop() },
    camera: 'primary',
    measure: ['solve', 'stars'],
    onKept: () => void kept.push(true),
  })

  const measured = (file: string): Measured => ({ file, result: 'measured', solve: { solved: false, reason: 'no stars' }, stars: { measured: true, hfd: 3, count: 12 }, header: {} })

  const fileCount = () => camera.script.sent.filter(sent => sent.property === 'CCD_EXPOSURE').length

  return { camera, frames, kept, labels, measured, fileCount }
}

const named = (camera: ReturnType<typeof setup>['camera'], index: number) => [...camera.files][index]!.split('/').pop()!

describe('taking a frame of the sweep', () => {
  it('starts one light run into the measure folder that measures solve and stars and asks for the frame to be kept', () => {
    const { camera, frames } = setup()

    expect(frames.begin(2)).toEqual({ ok: true })
    expect(camera.events[0]).toMatchObject({ kind: 'started', body: { object: 'horizon-sweep', frameType: 'light', exposureSeconds: 2, sequence: 'horizon-sweep_light', gain: 100, offset: 50 } })
  })

  it('refuses to begin when the camera reports no gain and offset', () => {
    const camera = fakeCamera({ omit: ['CCD_CONTROLS'] })
    const frames = makeSweepFrames({ picture: camera.picture, capture: { start: (request, between, measure, keep) => camera.capture.start(request, between, measure, keep), labelOf: camera.capture.labelOf, stop: () => camera.capture.stop() }, camera: 'primary', measure: ['solve'], onKept: () => undefined })

    expect(frames.begin(2)).toEqual({ ok: false, reason: 'primary has no gain and offset on the stream' })
  })

  it('exposes nothing until a frame is taken, and then exposes once and answers with the measure answer for that frame', async () => {
    const { camera, frames, measured, fileCount, kept } = setup()

    frames.begin(2)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fileCount()).toBe(0)

    const taken = frames.take()

    await vi.waitFor(() => expect(camera.files.size).toBe(1))
    expect(fileCount()).toBe(1)

    const file = named(camera, 0)

    expect(camera.capture.labelOf(file)).toMatchObject({ run: 'run-1', sequence: 'horizon-sweep_light', frame: 1, measure: ['solve', 'stars'], keep: true })

    frames.measured({ file: 'other_light_001.fits', result: 'refused', reason: 'not ours' })
    frames.measured(measured(file))

    expect(await taken).toMatchObject({ taken: 'measured', file })
    expect(kept).toHaveLength(1)

    await frames.end()
  })

  it('takes the next frame only when asked again, and matches each answer to its own frame', async () => {
    const { camera, frames, measured, fileCount } = setup()

    frames.begin(2)

    const first = frames.take()

    await vi.waitFor(() => expect(camera.files.size).toBe(1))
    frames.measured(measured(named(camera, 0)))
    await first

    await new Promise(resolve => setTimeout(resolve, 30))
    expect(fileCount()).toBe(1)

    const second = frames.take()

    await vi.waitFor(() => expect(camera.files.size).toBe(2))
    frames.measured(measured(named(camera, 0)))
    await new Promise(resolve => setTimeout(resolve, 10))
    frames.measured({ ...measured(named(camera, 1)), result: 'refused', reason: 'not set up' } as Measured)

    expect(await second).toEqual({ taken: 'refused', file: named(camera, 1), reason: 'not set up' })

    await frames.end()
  })

  it('answers failed when the exposure failed, and takes the frame again when asked', async () => {
    const { camera, frames, measured } = setup(['alert', 'file'])

    frames.begin(2)

    expect(await frames.take()).toEqual({ taken: 'failed', reason: 'the exposure did not finish' })

    const again = frames.take()

    await vi.waitFor(() => expect(camera.files.size).toBe(1))
    frames.measured(measured(named(camera, 0)))

    expect(await again).toMatchObject({ taken: 'measured' })

    await frames.end()
  })

  it('answers ended for a take when the run is ended under it, and for a take with no run', async () => {
    const { camera, frames } = setup()

    expect(await frames.take()).toEqual({ taken: 'ended', reason: 'no capture run is going' })

    frames.begin(2)

    const waiting = frames.take()

    await camera.capture.stop()

    expect(await waiting).toMatchObject({ taken: 'ended' })
  })

  it('collects the frames the rig program measured but could not keep, once', async () => {
    const { frames, camera } = setup()

    frames.begin(2)

    const taken = frames.take()

    await vi.waitFor(() => expect(camera.files.size).toBe(1))

    frames.notKept(named(camera, 0), 'EXDEV')
    frames.notKept('other_light_001.fits', 'EXDEV')

    expect(frames.problems()).toEqual([`${named(camera, 0)} was measured but not kept: EXDEV`])
    expect(frames.problems()).toEqual([])

    void taken

    await frames.end()
  })
})
