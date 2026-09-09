import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { AlpacaAcquisition, AlpacaCaptureOptions } from '@vela/alpaca'
import { createAlignmentController } from './controller.js'
import type { PhysicalAlignment } from './physical.js'
import { physicalAlignmentSample, projectPhysicalAlignmentTarget } from './physical-coordinates.js'
import type { PlateSolver, SkyPosition, SolveResult } from './solver.js'

const control = vi.hoisted(() => ({ waits: [] as Array<() => void>, afterPreview: undefined as undefined | (() => void) }))
vi.mock('node:timers/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:timers/promises')>(),
  setTimeout: (_ms: number, _value: unknown, options: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
    const finish = () => { options.signal.removeEventListener('abort', abort); resolve() }
    const abort = () => {
      const index = control.waits.indexOf(finish)
      if (index >= 0) control.waits.splice(index, 1)
      reject(new DOMException('Stopped', 'AbortError'))
    }
    options.signal.addEventListener('abort', abort, { once: true })
    if (options.signal.aborted) abort()
    else control.waits.push(finish)
  }),
}))
vi.mock('../imaging/preview.js', async importOriginal => {
  const original = await importOriginal<typeof import('../imaging/preview.js')>()
  return { ...original, previewPng: async (...args: Parameters<typeof original.previewPng>) => {
    const png = await original.previewPng(...args)
    control.afterPreview?.()
    return png
  } }
})

type FrameFixture = { capturedAt: string, solved: SkyPosition }
const fixture = JSON.parse(readFileSync(new URL('./physical-coordinates.fixture.json', import.meta.url), 'utf8')) as {
  site: { latitudeDegrees: number, longitudeDegrees: number, elevationMeters: number }
  cases: Array<{ samples: FrameFixture[], adjusted: FrameFixture }>
}
const frames = [...fixture.cases[0]!.samples, fixture.cases[0]!.adjusted]
const settings = { mode: 'physical' as const, endpoint: 'http://physical.test', cameraId: 'selected-camera', telescopeId: 'mount',
  executable: '/unused', catalogPath: '/unused', exposureSeconds: 2, fieldHeightDegrees: 3 }
const fieldHeightDegrees = 2 * Math.atan(4176 * 3.76 / 2000 / 400) * 180 / Math.PI
const stops: Array<() => Promise<unknown>> = []
beforeEach(() => { control.waits = []; control.afterPreview = undefined })
afterEach(async () => {
  control.afterPreview = undefined
  await Promise.all(stops.splice(0).map(stop => stop()))
  expect(control.waits).toHaveLength(0)
})

function setup() {
  let exposures = 0
  let externalChange = false
  const captures: AlpacaCaptureOptions[] = []
  const requests: Array<{ index: number, complete: () => void }> = []
  const hardware: AlpacaAcquisition = {
    capture: vi.fn(async options => {
      captures.push(options)
      const frame = frames[exposures++]!
      return { width: 4, height: 4, pixels: new Float64Array([900, 200, 900, 200, 200, 50, 200, 50, 900, 200, 900, 200, 200, 50, 200, 50]),
        capturedAt: frame.capturedAt, capturedAtSource: 'server-estimate' as const, color: { kind: 'bayer' as const, pattern: 'rggb' as const } }
    }),
    pointing: vi.fn(async () => { throw new Error('Physical mode must not read synthetic pointing') }),
    move: vi.fn(async () => { throw new Error('Physical mode must not perform a simulator preparation move') }),
    abort: vi.fn(async () => {}),
  }
  const sample = vi.fn((solved: SkyPosition, capture: { capturedAt: string, exposureSeconds: number }) => physicalAlignmentSample(solved, capture, fixture.site))
  const physical: PhysicalAlignment = {
    cameraName: 'Selected RGGB camera',
    prepare: vi.fn(async () => ({ fieldHeightDegrees })),
    pointing: vi.fn(async () => ({ hint: frames[exposures]!.solved, latitude: fixture.site.latitudeDegrees })),
    move: vi.fn(async () => {}),
    validate: vi.fn(async () => {
      if (externalChange) throw new Error('The mount pointing side changed. Measure a new baseline.')
      return { rightAscensionDegrees: 40, declinationDegrees: 60, coordinateSystem: 'topocentric' as const,
        tracking: true, slewing: false, parked: false, observedAt: frames[Math.max(0, exposures - 1)]!.capturedAt }
    }),
    sample,
    project: (wcs, target, current) => projectPhysicalAlignmentTarget(wcs, target, current, fixture.site),
  }
  const solver: PlateSolver = {
    solve: (_frame, _hint, signal) => new Promise<SolveResult>((resolve, reject) => {
      const index = exposures - 1
      const abort = () => reject(new DOMException('Stopped', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      requests.push({ index, complete: () => {
        signal.removeEventListener('abort', abort)
        const frame = frames[index]!
        resolve({ status: 'solved', capturedAt: frame.capturedAt, ...frame.solved,
          wcs: { width: 4, height: 4, referenceX: 2.5, referenceY: 2.5, ...frame.solved, cd: [0.1, 0, 0, -0.1] } })
      } })
    }),
  }
  const solverFactory = vi.fn((_height: number) => solver)
  const controller = createAlignmentController(settings, hardware, solverFactory, Date.now, physical)
  stops.push(() => controller.stop())
  async function nextSolve() {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))
    return requests.shift()!
  }
  async function baseline() {
    await controller.start('physical', 'Physical rig')
    for (let index = 0; index < 3; index++) (await nextSolve()).complete()
  }
  return { controller, hardware, physical, sample, captures, solverFactory, baseline, nextSolve,
    changeMount: () => { externalChange = true } }
}

it('uses physical optics, selected Bayer camera, and midpoint geometry while preserving capture start and provenance', async () => {
  const subject = setup()
  await subject.baseline()
  await vi.waitFor(() => expect(subject.controller.snapshot().measurement).not.toBeNull())
  expect(subject.solverFactory).toHaveBeenCalledWith(fieldHeightDegrees)
  expect(subject.hardware.pointing).not.toHaveBeenCalled()
  expect(subject.hardware.move).not.toHaveBeenCalled()
  expect(subject.physical.move).toHaveBeenCalledTimes(2)
  expect(subject.captures).toHaveLength(3)
  for (const capture of subject.captures) {
    expect(capture).toMatchObject({ cameraId: 'selected-camera', expectedCameraName: 'Selected RGGB camera', exposureSeconds: 2 })
    expect(capture).not.toHaveProperty('monochromeOnly')
  }
  const view = subject.controller.snapshot()
  expect(view).toMatchObject({ phase: 'adjusting', mode: 'physical', cameraName: 'Selected RGGB camera', measuredAt: frames[2]!.capturedAt,
    measurement: { fieldHeightDegrees, capturedAtSource: 'server-estimate' } })
  expect(subject.sample.mock.calls[2]![1]).toEqual({ capturedAt: frames[2]!.capturedAt, exposureSeconds: 2 })
  expect(Date.parse(subject.sample.mock.results[2]!.value.capturedAt) - Date.parse(view.measuredAt!)).toBe(1000)
  const imageId = view.measurement!.imageUrl.split('/').at(-1)!
  const png = subject.controller.image(imageId)!
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png[25]).toBe(2) // PNG IHDR color type: RGB, not grayscale Bayer samples.
})

it.each(['during solve', 'during preview'] as const)('rejects external movement %s before first publication', async timing => {
  const subject = setup()
  await subject.controller.start('physical', 'Physical rig')
  for (let index = 0; index < 2; index++) (await subject.nextSolve()).complete()
  const final = await subject.nextSolve()
  expect(subject.controller.snapshot()).toMatchObject({ activity: 'solving', measurement: null })
  if (timing === 'during solve') subject.changeMount()
  else control.afterPreview = subject.changeMount
  final.complete()
  await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', measuredAt: null, measurement: null,
    error: 'The mount pointing side changed. Measure a new baseline.' })
})

it('retains the previous solved image and timestamp when external movement invalidates a new preview', async () => {
  const subject = setup()
  await subject.baseline()
  await vi.waitFor(() => expect(control.waits).toHaveLength(1))
  const previous = subject.controller.snapshot()
  const previousImageId = previous.measurement!.imageUrl.split('/').at(-1)!
  const previousImage = subject.controller.image(previousImageId)
  control.waits.shift()!()
  const next = await subject.nextSolve()
  expect(next.index).toBe(3)
  expect(subject.controller.snapshot().measurement).toBe(previous.measurement)
  control.afterPreview = subject.changeMount
  next.complete()
  await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', measuredAt: previous.measuredAt, measurement: previous.measurement })
  expect(subject.controller.image(previousImageId)).toBe(previousImage)
})
