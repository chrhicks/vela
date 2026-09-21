import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestCadence } from './test-cadence.js'
import { fixture } from './physical-fixture.js'
import { previewPng } from '../imaging/preview.js'
import {
  AlpacaProviderError,
  AlpacaCaptureRetryableError,
  type AlpacaAcquisition,
  type AlpacaCaptureOptions,
} from '@vela/alpaca'
import { createAlignmentController } from './controller.js'
import type { PhysicalAlignment } from './physical.js'
import { physicalAlignmentSample, projectPhysicalAlignmentTarget } from './physical-coordinates.js'
import type { PlateSolver, SkyPosition, SolveResult } from './solver.js'
import {
  createAlignmentDiagnostics,
  type AlignmentDiagnosticRun,
  type AlignmentDiagnosticsFactory,
} from './diagnostics.js'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'

const control: {
  waits: Array<() => void>
  wait: (signal: AbortSignal) => Promise<void>
  afterPreview?: (() => void) | undefined
} = createTestCadence()

const frames = [...fixture.cases[0]!.samples, fixture.cases[0]!.adjusted]

const settings = {
  mode: 'physical' as const,
  endpoint: 'http://physical.test',
  cameraId: 'selected-camera',
  telescopeId: 'mount',
  executable: '/unused',
  catalogPath: '/unused',
  exposureSeconds: 2,
  fieldHeightDegrees: 3,
}

const fieldHeightDegrees = (2 * Math.atan((4176 * 3.76) / 2000 / 400) * 180) / Math.PI

const stops: Array<ReturnType<typeof createAlignmentController>['stop']> = []

afterEach(async () => {
  control.afterPreview = undefined
  await Promise.all(stops.splice(0).map(stop => stop()))
  expect(control.waits).toHaveLength(0)
})

function setup(openDiagnostics?: AlignmentDiagnosticsFactory) {
  let exposures = 0
  let externalChange = false
  const captures: AlpacaCaptureOptions[] = []
  const requests: Array<{ index: number; complete: () => void }> = []

  const hardware: AlpacaAcquisition = {
    rotateRightAscension: async () => {
      throw new Error('Unexpected physical rotation')
    },
    capture: vi.fn(async options => {
      captures.push(options)
      const frame = frames[exposures++]!

      return {
        width: 4,
        height: 4,
        pixels: new Float64Array([
          900, 200, 900, 200, 200, 50, 200, 50, 900, 200, 900, 200, 200, 50, 200, 50,
        ]),
        capturedAt: frame.capturedAt,
        capturedAtSource: 'server-estimate' as const,
        color: { kind: 'bayer' as const, pattern: 'rggb' as const },
      }
    }),
    pointing: vi.fn(async () => {
      throw new Error('Physical mode must not read synthetic pointing')
    }),
    move: vi.fn(async () => {
      throw new Error('Physical mode must not perform a simulator preparation move')
    }),
    abort: vi.fn(async () => {}),
  }

  const sample = vi.fn(
    (solved: SkyPosition, capture: { capturedAt: string; exposureSeconds: number }) =>
      physicalAlignmentSample(solved, capture, fixture.site),
  )

  const observedMount = () => ({
    rightAscensionDegrees: 40,
    declinationDegrees: 60,
    coordinateSystem: 'topocentric' as const,
    ...fixture.site,
    tracking: true,
    slewing: false,
    parked: false,
    observedAt: frames[Math.max(0, exposures - 1)]!.capturedAt,
  })

  const physical: PhysicalAlignment = {
    cameraName: 'Selected RGGB camera',
    prepare: vi.fn(async () => ({ fieldHeightDegrees })),
    pointing: vi.fn(async () => ({
      hint: frames[exposures]!.solved,
      latitude: fixture.site.latitudeDegrees,
      observation: {
        site: fixture.site,
        mount: observedMount(),
        camera: {
          cameraName: 'Selected RGGB camera',
          sensorWidthPixels: 4,
          sensorHeightPixels: 4,
          pixelWidthMicrons: 3.76,
          pixelHeightMicrons: 3.76,
          binX: 1,
          binY: 1,
          width: 4,
          height: 4,
          startX: 0,
          startY: 0,
        },
      },
    })),
    move: vi.fn(async () => {}),
    validate: vi.fn(async () => {
      if (externalChange)
        throw new Error('The mount pointing side changed. Measure a new baseline.')

      return observedMount()
    }),
    sample,
    project: (wcs, target, current) =>
      projectPhysicalAlignmentTarget(wcs, target, current, fixture.site),
  }

  const solver: PlateSolver = {
    solve: (_frame, _hint, signal) =>
      new Promise<SolveResult>((resolve, reject) => {
        const index = exposures - 1
        const abort = () => reject(new DOMException('Stopped', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        requests.push({
          index,
          complete: () => {
            signal.removeEventListener('abort', abort)
            const frame = frames[index]!
            resolve({
              status: 'solved',
              capturedAt: frame.capturedAt,
              ...frame.solved,
              wcs: {
                width: 4,
                height: 4,
                referenceX: 2.5,
                referenceY: 2.5,
                ...frame.solved,
                cd: [0.1, 0, 0, -0.1],
              },
            })
          },
        })
      }),
  }

  const solverFactory = vi.fn((_height: number) => solver)

  const controller = createAlignmentController({
    mode: 'physical',
    settings,
    hardware,
    physical,
    createSolver: solverFactory,
    waitForNextExposure: control.wait,
    openDiagnostics,
    renderPreview: async (...args) => {
      const png = await previewPng(...args)
      control.afterPreview?.()

      return png
    },
  })

  stops.push(() => controller.stop())

  async function nextSolve() {
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0))

    return requests.shift()!
  }

  async function baseline(onSettled?: () => void) {
    await controller.start('physical', 'Physical rig', onSettled)

    for (let index = 0; index < 3; index++) (await nextSolve()).complete()
  }

  return {
    controller,
    hardware,
    physical,
    sample,
    captures,
    solverFactory,
    baseline,
    nextSolve,
    changeMount: () => {
      externalChange = true
    },
  }
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
    expect(capture).toMatchObject({
      cameraId: 'selected-camera',
      expectedCameraName: 'Selected RGGB camera',
      exposureSeconds: 2,
    })
    expect(capture).not.toHaveProperty('monochromeOnly')
  }

  const view = subject.controller.snapshot()
  expect(view).toMatchObject({
    phase: 'adjusting',
    mode: 'physical',
    cameraName: 'Selected RGGB camera',
    measuredAt: frames[2]!.capturedAt,
    measurement: { fieldHeightDegrees, capturedAtSource: 'server-estimate' },
  })
  expect(subject.sample.mock.calls[2]![1]).toEqual({
    capturedAt: frames[2]!.capturedAt,
    exposureSeconds: 2,
  })
  expect(
    Date.parse(subject.sample.mock.results[2]!.value.capturedAt) - Date.parse(view.measuredAt!),
  ).toBe(1000)
  const imageId = view.measurement!.imageUrl.split('/').at(-1)!
  const png = subject.controller.image(imageId)!
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png[25]).toBe(2) // PNG IHDR color type: RGB, not grayscale Bayer samples.
})

it.each(['during solve', 'during preview'] as const)(
  'rejects external movement %s before first publication',
  async timing => {
    const subject = setup()
    await subject.controller.start('physical', 'Physical rig')

    const first = await subject.nextSolve()
    first.complete()
    const second = await subject.nextSolve()

    if (timing === 'during preview') control.afterPreview = subject.changeMount
    second.complete()

    if (timing === 'during solve') {
      const final = await subject.nextSolve()
      expect(subject.controller.snapshot()).toMatchObject({
        activity: 'solving',
        measurement: null,
      })
      subject.changeMount()
      final.complete()
    }

    await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
    expect(subject.controller.snapshot()).toMatchObject({
      phase: 'failed',
      measuredAt: null,
      measurement: null,
      error: 'The mount pointing side changed. Measure a new baseline.',
    })
  },
)

it('retains the previous solved image and timestamp when external movement invalidates a new preview', async () => {
  const subject = setup()
  await subject.baseline()
  await vi.waitFor(() => expect(control.waits).toHaveLength(1))
  const previous = subject.controller.snapshot()
  const previousImageId = previous.measurement!.imageUrl.split('/').at(-1)!
  const previousImage = subject.controller.image(previousImageId)
  control.afterPreview = subject.changeMount
  control.waits.shift()!()
  await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
  expect(subject.controller.snapshot()).toMatchObject({
    phase: 'failed',
    measuredAt: previous.measuredAt,
    measurement: previous.measurement,
  })
  expect(subject.controller.image(previousImageId)).toBe(previousImage)
})

it('shows homing and permits Stop before any exposure begins', async () => {
  const subject = setup()
  vi.mocked(subject.physical.prepare).mockImplementation(
    signal =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), {
          once: true,
        })
      }),
  )
  await subject.controller.start('physical', 'Physical rig')
  expect(subject.controller.snapshot()).toMatchObject({ active: true, activity: 'homing' })
  expect(subject.hardware.capture).not.toHaveBeenCalled()
  await subject.controller.stop()
  expect(subject.controller.snapshot()).toMatchObject({ active: false, phase: 'stopped' })
  expect(subject.hardware.capture).not.toHaveBeenCalled()
})

const readTimeout = () =>
  new AlpacaProviderError('Device read timed out', {
    reason: 'transport',
    endpoint: '/management/v1/configureddevices',
  })

it('keeps the baseline and last measurement through repeated read interruptions and resumes without moving', async () => {
  const subject = setup()
  await subject.baseline()
  await vi.waitFor(() => expect(subject.controller.snapshot().measurement).not.toBeNull())
  const previous = subject.controller.snapshot()
  vi.mocked(subject.physical.pointing)
    .mockRejectedValueOnce(readTimeout())
    .mockRejectedValueOnce(readTimeout())

  for (let attempt = 0; attempt < 2; attempt++) {
    control.waits.shift()!()
    await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('retrying'))
    await vi.waitFor(() => expect(control.waits).toHaveLength(1))
    expect(subject.controller.snapshot()).toMatchObject({
      active: true,
      phase: 'adjusting',
      measurement: previous.measurement,
      measuredAt: previous.measuredAt,
    })
    expect(subject.captures).toHaveLength(3)
  }

  control.waits.shift()!()
  const solve = await subject.nextSolve()
  solve.complete()
  await vi.waitFor(() =>
    expect(subject.controller.snapshot().measuredAt).toBe(frames[3]!.capturedAt),
  )
  expect(subject.controller.snapshot()).toMatchObject({
    active: true,
    phase: 'adjusting',
    warning: null,
  })
  expect(subject.physical.prepare).toHaveBeenCalledTimes(1)
  expect(subject.physical.move).toHaveBeenCalledTimes(2)
})

it('stops promptly while a read is waiting to retry', async () => {
  const subject = setup()
  await subject.baseline()
  await vi.waitFor(() => expect(subject.controller.snapshot().measurement).not.toBeNull())
  vi.mocked(subject.physical.pointing).mockRejectedValue(readTimeout())
  control.waits.shift()!()
  await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('retrying'))
  await subject.controller.stop()
  expect(subject.controller.snapshot()).toMatchObject({
    active: false,
    phase: 'stopped',
    warning: null,
  })
  expect(subject.captures).toHaveLength(3)
})

it('retries validation of the same captured frame without repeating an exposure', async () => {
  const subject = setup()
  vi.mocked(subject.physical.validate).mockRejectedValueOnce(readTimeout())
  await subject.controller.start('physical', 'Physical rig')
  await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('retrying'))
  expect(subject.captures).toHaveLength(1)
  control.waits.shift()!()
  await subject.nextSolve()
  expect(subject.captures).toHaveLength(1)
  expect(subject.controller.snapshot()).toMatchObject({
    active: true,
    warning: null,
    activity: 'solving',
  })
})

it('retries an explicitly recoverable capture but stops on an unclassified transport failure', async () => {
  const subject = setup()
  vi.mocked(subject.hardware.capture).mockRejectedValueOnce(
    new AlpacaCaptureRetryableError(readTimeout()),
  )
  await subject.controller.start('physical', 'Physical rig')
  await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('retrying'))
  vi.mocked(subject.hardware.capture).mockRejectedValueOnce(readTimeout())
  control.waits.shift()!()
  await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
  expect(subject.hardware.capture).toHaveBeenCalledTimes(2)
  expect(subject.physical.pointing).toHaveBeenCalledTimes(2)
  expect(subject.controller.snapshot()).toMatchObject({
    phase: 'failed',
    error: 'Device read timed out',
  })
})

it('revalidates mount state before a fresh pre-start capture retry', async () => {
  const subject = setup()
  vi.mocked(subject.hardware.capture).mockRejectedValueOnce(
    new AlpacaCaptureRetryableError(readTimeout()),
  )
  await subject.controller.start('physical', 'Physical rig')
  await vi.waitFor(() => expect(control.waits).toHaveLength(1))
  vi.mocked(subject.physical.pointing).mockRejectedValueOnce(new Error('Tracking is off'))
  control.waits.shift()!()
  await vi.waitFor(() => expect(subject.controller.active()).toBe(false))
  expect(subject.hardware.capture).toHaveBeenCalledOnce()
  expect(subject.controller.snapshot()).toMatchObject({ phase: 'failed', error: 'Tracking is off' })
})

it('preserves the alignment baseline and timer through same-exposure read recovery, then publishes only the solved result', async () => {
  const subject = setup()
  await subject.baseline()
  await vi.waitFor(() => expect(control.waits).toHaveLength(1))
  const previous = subject.controller.snapshot()
  const original = vi.mocked(subject.hardware.capture).getMockImplementation()!
  let complete = () => {}

  vi.mocked(subject.hardware.capture).mockImplementationOnce(async input => {
    const frame = await original(input)
    await new Promise<void>(resolve => {
      complete = resolve
    })

    return frame
  })
  control.waits.shift()!()
  await vi.waitFor(() => expect(subject.captures).toHaveLength(4))
  const pending = subject.captures[3]!
  const startedAt = subject.controller.snapshot().exposureStartedAt
  pending.onReadState!('retrying')
  expect(subject.controller.snapshot()).toMatchObject({
    phase: 'adjusting',
    activity: 'retrying',
    exposureStartedAt: null,
    warning: expect.stringContaining('interrupted'),
    measurement: previous.measurement,
    measuredAt: previous.measuredAt,
  })
  pending.onReadState!('current')
  expect(subject.controller.snapshot()).toMatchObject({
    active: true,
    activity: 'exposing',
    exposureStartedAt: startedAt,
    warning: null,
    measurement: previous.measurement,
    measuredAt: previous.measuredAt,
  })
  expect(subject.hardware.capture).toHaveBeenCalledTimes(4)
  expect(subject.physical.move).toHaveBeenCalledTimes(2)
  complete()
  const solve = await subject.nextSolve()
  pending.onReadState!('retrying')
  expect(subject.controller.snapshot()).toMatchObject({
    activity: 'solving',
    warning: null,
    exposureStartedAt: null,
  })
  solve.complete()
  await vi.waitFor(() =>
    expect(subject.controller.snapshot().measuredAt).toBe(frames[3]!.capturedAt),
  )
})

it.each([
  { cleanup: new DOMException('Stopped', 'AbortError'), phase: 'stopped' },
  { cleanup: new Error('Camera cleanup unconfirmed'), phase: 'failed' },
])(
  'keeps the alignment lease and measurement through Stop in capture read recovery until $phase',
  async ({ cleanup, phase }) => {
    const subject = setup()
    const released = vi.fn()
    await subject.baseline(released)
    await vi.waitFor(() => expect(control.waits).toHaveLength(1))
    const previous = subject.controller.snapshot()
    let capture: AlpacaCaptureOptions | undefined
    let fail = (_error: Error) => {}

    vi.mocked(subject.hardware.capture).mockImplementationOnce(input => {
      capture = input

      return new Promise((_resolve, reject) => {
        fail = reject
      })
    })
    control.waits.shift()!()
    await vi.waitFor(() => expect(capture).toBeDefined())
    capture!.onReadState!('retrying')
    const stopping = subject.controller.stop()
    await vi.waitFor(() => expect(capture!.signal!.aborted).toBe(true))
    capture!.onReadState!('retrying')
    expect(subject.controller.snapshot()).toMatchObject({
      active: true,
      activity: 'stopping',
      warning: null,
      exposureStartedAt: null,
    })
    expect(released).not.toHaveBeenCalled()
    fail(cleanup)
    await stopping
    capture!.onReadState!('current')
    expect(subject.controller.snapshot()).toMatchObject({
      active: false,
      phase,
      activity: 'idle',
      exposureStartedAt: null,
      warning: null,
      measurement: previous.measurement,
      measuredAt: previous.measuredAt,
    })
    expect(subject.hardware.capture).toHaveBeenCalledTimes(4)
    expect(subject.physical.move).toHaveBeenCalledTimes(2)
    expect(released).toHaveBeenCalledOnce()
  },
)

function recording(): AlignmentDiagnosticRun {
  return {
    recordFrame: vi.fn(async () => {}),
    recordBaseline: vi.fn(async () => {}),
    recordMeasurement: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
  }
}

it('records the exact solved baseline, midpoint, site and existing mount observations before finishing', async () => {
  const evidence = recording()
  const open = vi.fn(async () => evidence)
  const subject = setup(open)
  await subject.baseline()
  await vi.waitFor(() => expect(control.waits).toHaveLength(1))
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      rigId: 'physical',
      mode: 'physical',
      cameraName: 'Selected RGGB camera',
      exposureSeconds: 2,
    }),
  )
  expect(evidence.recordFrame).toHaveBeenCalledTimes(3)
  const [frame, recorded] = vi.mocked(evidence.recordFrame).mock.calls[0]!
  expect(frame.capturedAtSource).toBe('server-estimate')
  expect(recorded).toMatchObject({
    phase: 'baseline',
    position: 1,
    solution: { ...frames[0]!.solved },
    physical: {
      site: fixture.site,
      before: { observedAt: frame.capturedAt },
      after: { observedAt: frame.capturedAt },
    },
  })
  expect(Date.parse(recorded.sample.capturedAt) - Date.parse(frame.capturedAt)).toBe(1000)
  expect(vi.mocked(evidence.recordBaseline).mock.calls[0]![0]).toEqual(
    subject.sample.mock.results.map(result => result.value),
  )

  control.waits.shift()!()
  const adjusted = await subject.nextSolve()
  adjusted.complete()
  await vi.waitFor(() => expect(control.waits).toHaveLength(1))
  expect(evidence.recordFrame).toHaveBeenLastCalledWith(
    expect.objectContaining({ capturedAt: frames[3]!.capturedAt }),
    expect.objectContaining({ phase: 'adjusting', position: 3 }),
  )
  expect(evidence.recordMeasurement).toHaveBeenCalledTimes(2)
  expect(vi.mocked(evidence.recordMeasurement).mock.calls[1]![1]).toMatchObject({
    altitudeArcsec: expect.any(Number),
    azimuthArcsec: expect.any(Number),
  })
  await subject.controller.stop(true)
  expect(evidence.finish).toHaveBeenCalledExactlyOnceWith({ phase: 'finished', error: null })
  expect(subject.captures).toHaveLength(4)
})

it('waits for an in-flight diagnostic write on Stop and starts no further exposure or movement', async () => {
  const evidence = recording()
  let completeWrite = () => {}

  vi.mocked(evidence.recordFrame).mockImplementation(
    () =>
      new Promise<void>(resolve => {
        completeWrite = resolve
      }),
  )
  const subject = setup(async () => evidence)
  await subject.controller.start('physical', 'Physical rig')
  const first = await subject.nextSolve()
  first.complete()
  await vi.waitFor(() => expect(evidence.recordFrame).toHaveBeenCalledTimes(1))

  let stopped = false

  const stopping = subject.controller.stop().then(() => {
    stopped = true
  })

  await vi.waitFor(() => expect(subject.controller.snapshot().activity).toBe('stopping'))
  expect(stopped).toBe(false)
  completeWrite()
  await stopping
  expect(subject.captures).toHaveLength(1)
  expect(subject.physical.move).not.toHaveBeenCalled()
  expect(evidence.finish).toHaveBeenCalledExactlyOnceWith({ phase: 'stopped', error: null })
})

it('reports an unavailable diagnostic destination without losing the alignment or replaying hardware commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-alignment-diagnostic-failure-'))
  const blocked = join(directory, 'not-a-directory')
  await writeFile(blocked, 'occupied')
  const errors: Error[] = []
  const subject = setup(createAlignmentDiagnostics(blocked, error => errors.push(error)))

  try {
    await subject.baseline()
    await vi.waitFor(() => expect(control.waits).toHaveLength(1))
    expect(errors).toHaveLength(1)
    expect(subject.controller.snapshot()).toMatchObject({
      active: true,
      phase: 'adjusting',
      error: null,
    })
    expect(subject.captures).toHaveLength(3)
    expect(subject.physical.prepare).toHaveBeenCalledTimes(1)
    expect(subject.physical.move).toHaveBeenCalledTimes(2)
  } finally {
    await subject.controller.stop()
    await rm(directory, { recursive: true, force: true })
  }
})

it('replays a physical controller trial from its actual recorded bundle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-physical-controller-replay-'))
  const errors: Error[] = []
  const subject = setup(createAlignmentDiagnostics(directory, error => errors.push(error)))

  try {
    await subject.baseline()
    await vi.waitFor(() => expect(control.waits).toHaveLength(1))
    control.waits.shift()!()
    const adjusted = await subject.nextSolve()
    adjusted.complete()
    await vi.waitFor(() => expect(control.waits).toHaveLength(1))
    await subject.controller.stop(true)
    expect(errors).toEqual([])
    const report = await replayAlignmentDiagnostics(join(directory, (await readdir(directory))[0]!))
    expect(report).toMatchObject({
      mode: 'physical',
      outcome: { phase: 'finished', error: null },
      counts: { frames: 4, measurements: 2, physicalFrames: 4, verifiedOriginals: 4 },
      maximumDiscrepancies: {
        measurementArcsec: 0,
        correctionTargetDegrees: 0,
        physicalSampleDegrees: 0,
        physicalSampleTimeMs: 0,
      },
    })
    expect(report.finalMeasurement?.totalArcsec).toBe(
      subject.controller.snapshot().measurement?.totalArcsec,
    )
  } finally {
    await subject.controller.stop()
    await rm(directory, { recursive: true, force: true })
  }
})
