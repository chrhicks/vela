import { expect, it, vi } from 'vitest'
import { createFramingController, type FramingHardware } from './framing.js'
import type { PlateSolver, SolveResult } from '../plate-solving/solver.js'

const capturedAt = '2026-09-30T23:00:00Z'

const desired = { raDegrees: 10, decDegrees: 20 }

const frame = { width: 3, height: 2, pixels: [1, 2, 3, 4, 5, 6], capturedAt, capturedAtSource: 'server-estimate' as const }

const solved: SolveResult = {
  status: 'solved', ...desired, capturedAt,
  wcs: { width: 3, height: 2, referenceX: 2, referenceY: 1.5, ...desired, cd: [-0.01, 0, 0, 0.01] },
}

function setup() {
  const render = vi.fn(async () => ({ native: Buffer.from('native'), fit: Buffer.from('fit') }))
  const analyze = vi.fn(async () => ({ detectedStars: 2, medianHfrPixels: 1.2 }))
  const controller = createFramingController(() => new Date(capturedAt), async () => {}, { render, analyze })

  const hardware: FramingHardware = {
    status: vi.fn(async () => ({ rightAscensionDegrees: 10, declinationDegrees: 20,
      coordinateSystem: 'j2000', tracking: true, slewing: false, parked: false,
      observedAt: capturedAt, latitudeDegrees: 40, longitudeDegrees: -75 })),
    tracking: vi.fn(), slew: vi.fn(), capture: vi.fn(async () => frame),
  }

  const solve = vi.fn<PlateSolver['solve']>(async () => solved)

  function check() {
    return new Promise<void>(resolve => controller.start({ desired, targetId: 'target', rigId: 'rig',
      cameraName: 'Selected camera', exposureSeconds: 2, configuration: 'fixed', action: 'check' },
    hardware, { solve }, resolve))
  }

  return { controller, hardware, render, analyze, solve, check }
}

it('solves, renders and measures the same acquisition with distinct immutable resources', async () => {
  const s = setup()
  await s.check()
  const { preview, actual } = s.controller.snapshot()
  expect(preview).toMatchObject({ rigId: 'rig', targetId: 'target', width: 3, height: 2,
    cameraName: 'Selected camera', capturedAt, capturedAtSource: 'server-estimate', exposureSeconds: 2,
    checkId: actual!.checkId, statistics: { detectedStars: 2, medianHfrPixels: 1.2 } })
  expect(s.render).toHaveBeenCalledWith(3, 2, frame.pixels, undefined)
  expect(s.analyze).toHaveBeenCalledWith(3, 2, frame.pixels, undefined)
  expect(s.solve.mock.calls[0]![0]).toBe(frame)
  expect(s.controller.preview(preview!.id, 'fit')?.toString()).toBe('fit')
  expect(s.controller.preview(preview!.id, 'native')?.toString()).toBe('native')
  expect(s.hardware.capture).toHaveBeenCalledTimes(1)
  expect(s.hardware.slew).not.toHaveBeenCalled()
  expect(s.hardware.tracking).not.toHaveBeenCalled()
})

it('retains the newer unsolved preview separately from the older solved footprint', async () => {
  const s = setup()
  await s.check()
  const previous = s.controller.snapshot()
  s.solve.mockResolvedValueOnce({ status: 'no-solution' })
  await s.check()
  const next = s.controller.snapshot()
  expect(next.phase).toBe('needs-check')
  expect(next.actual).toEqual(previous.actual)
  expect(next.preview!.id).not.toBe(previous.preview!.id)
  expect(next.preview!.checkId).toBeNull()
  expect(next.preview!.previewUrl).toContain(next.preview!.id)
  expect(s.hardware.capture).toHaveBeenCalledTimes(2)
})

it('keeps successful solve independent from rendering and analysis failures', async () => {
  const s = setup()
  s.render.mockRejectedValueOnce(new Error('PNG failed'))
  s.analyze.mockRejectedValueOnce(new Error('statistics failed'))
  await s.check()
  const view = s.controller.snapshot()
  expect(view.phase).toBe('checked')
  expect(view.preview).toMatchObject({ checkId: view.actual!.checkId, previewUrl: null,
    nativePreviewUrl: null, statistics: null })
  expect(s.hardware.capture).toHaveBeenCalledTimes(1)
})

it('evicts only the oldest pair after three acquisitions and never changes old URL meaning', async () => {
  const s = setup()
  const ids: string[] = []

  for (let i = 0; i < 4; i++) {
    await s.check()
    ids.push(s.controller.snapshot().preview!.id)
  }

  expect(new Set(ids).size).toBe(4)
  expect(s.controller.preview(ids[0]!, 'native')).toBeUndefined()

  for (const id of ids.slice(1)) expect(s.controller.preview(id, 'native')).toBeDefined()
})

it('waits for consumers to release samples and rejects preview completion after Stop', async () => {
  const s = setup()
  let finish!: (value: Awaited<ReturnType<typeof s.render>>) => void
  s.render.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const checked = s.check()
  await vi.waitFor(() => expect(s.render).toHaveBeenCalled())
  const stopped = s.controller.stop()
  finish({ native: Buffer.from('late'), fit: Buffer.from('late') })
  await Promise.all([checked, stopped])
  expect(s.controller.snapshot()).toMatchObject({ phase: 'stopped', preview: null, actual: null })
  await s.check()
  expect(s.controller.snapshot().phase).toBe('checked')
  expect(s.controller.snapshot().preview!.checkId).toBe(s.controller.snapshot().actual!.checkId)
})
