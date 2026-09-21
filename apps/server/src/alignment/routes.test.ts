import type { AlignmentView } from '@vela/model/web'
import { createAlpacaAcquisition, createAlpacaFraming } from '@vela/alpaca'
import { createAlignmentController } from './controller.js'
import { createPhysicalAlignment } from './physical.js'
import { createAstapSolver } from './solver.js'
import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { createRigOperations } from '../rig/operations.js'
import { alignmentSettings, registerAlignment } from './routes.js'

const initialState: AlignmentView = {
  rigId: '',
  rigName: '',
  active: false,
  enabled: true,
  unavailableReason: null,
  phase: 'setup',
  activity: 'idle',
  position: 0,
  solvedPositions: 0,
  exposureSeconds: 2,
  exposureStartedAt: null,
  measuredAt: null,
  warning: null,
  error: null,
  measurement: null,
}

const mocks = {
  acquisition: vi.fn(createAlpacaAcquisition),
  framing: vi.fn(createAlpacaFraming),
  physical: vi.fn(createPhysicalAlignment),
  solver: vi.fn(createAstapSolver),
  controller: vi.fn(createAlignmentController),
  start: vi.fn<ReturnType<typeof createAlignmentController>['start']>(),
  stop: vi.fn<ReturnType<typeof createAlignmentController>['stop']>(),
  state: initialState,
}

const env = {
  VELA_ALIGNMENT_ENDPOINT: 'http://mount:11111',
  VELA_ALIGNMENT_CAMERA_ID: 'camera',
  VELA_ALIGNMENT_TELESCOPE_ID: 'telescope',
  VELA_ASTAP: '/bin/astap',
  VELA_STAR_CATALOG: '/stars',
}

const rig: RigCatalogRecord = {
  id: 'rig',
  name: 'FRA',
  endpoint: { host: 'mount', port: 11111 },
  imagingCamera: { uniqueId: 'camera', name: 'Current imager' },
  focalLengthMm: 400,
  addedAt: '2026-09-09T00:00:00Z',
  lastObservedInventory: {
    observedAt: '2026-09-09T00:00:00Z',
    devices: [
      { uniqueId: 'camera', kind: 'camera', name: 'Old inventory name' },
      { uniqueId: 'telescope', kind: 'telescope', name: 'Mount' },
    ],
  },
}

const { imagingCamera: _camera, ...withoutCamera } = rig

const { focalLengthMm: _focalLength, ...withoutFocalLength } = rig

const { focalLengthMm: _offlineFocalLength, ...offlineRig } = withoutCamera

const apps: ReturnType<typeof Fastify>[] = []

let release: (() => void) | undefined

beforeEach(() => {
  vi.resetAllMocks()
  mocks.state = { ...initialState }
  release = undefined
  mocks.acquisition.mockImplementation(createAlpacaAcquisition)
  mocks.framing.mockImplementation(createAlpacaFraming)
  mocks.physical.mockImplementation(createPhysicalAlignment)
  mocks.solver.mockImplementation(createAstapSolver)
  mocks.start.mockImplementation(async (rigId: string, _name: string, onSettled?: () => void) => {
    mocks.state = { ...mocks.state, rigId, active: true }
    release = onSettled

    return mocks.state
  })
  mocks.stop.mockImplementation(async () => {
    mocks.state.active = false
    release?.()

    return mocks.state
  })
  mocks.controller.mockImplementation(() => ({
    snapshot: () => ({ ...mocks.state }),
    active: () => mocks.state.active,
    start: mocks.start,
    stop: mocks.stop,
    image: () => undefined,
  }))
})

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

function setup(
  records = [rig],
  configured = true,
  mode: 'physical' | 'offline' = 'physical',
  diagnosticsPath?: string,
) {
  const app = Fastify()
  apps.push(app)
  const catalog = createMemoryRigCatalog(records)
  const operations = createRigOperations()
  registerAlignment(
    app,
    catalog,
    configured
      ? alignmentSettings({
        ...env,
        VELA_ALIGNMENT_MODE: mode,
        VELA_ALIGNMENT_DIAGNOSTICS_PATH: diagnosticsPath,
      })
      : undefined,
    operations,
    mocks,
  )

  const command = (
    name: string,
    rigId = 'rig',
    payload: null | string | readonly string[] | { exposureSeconds?: number } = {},
  ) => app.inject({
    method: 'POST',
    url: `/api/rigs/${rigId}/alignment/${name}`,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  })

  return { app, catalog, operations, command }
}

describe('alignment environment settings', () => {
  it('remains unavailable without an explicit endpoint', () => { expect(alignmentSettings({})).toBeUndefined() })
  it.each([undefined, 'offline', 'physical'])('accepts configured mode %s', mode => {
    expect(alignmentSettings({ ...env, VELA_ALIGNMENT_MODE: mode })).toMatchObject({
      endpoint: env.VELA_ALIGNMENT_ENDPOINT,
      cameraId: 'camera',
      telescopeId: 'telescope',
      executable: '/bin/astap',
      catalogPath: '/stars',
    })
    expect(alignmentSettings({ ...env, VELA_ALIGNMENT_MODE: mode })?.mode).toBe(mode === 'physical' ? 'physical' : undefined)
  })
  it.each(['https://mount:11111', 'http://mount:11111/api', 'http://user:pass@mount:11111', 'http://mount:11111/?x=1'])('rejects invalid endpoint %s', endpoint => {
    expect(() => alignmentSettings({ ...env, VELA_ALIGNMENT_ENDPOINT: endpoint })).toThrow()
  })
  it('rejects unknown mode and incomplete configuration', () => {
    expect(() => alignmentSettings({ ...env, VELA_ALIGNMENT_MODE: 'real' })).toThrow('MODE')
    expect(() => alignmentSettings({ ...env, VELA_ASTAP: undefined })).toThrow('requires')
  })
  it('enables diagnostic recording only with an explicit absolute destination', () => {
    expect(alignmentSettings(env)?.diagnosticsPath).toBeUndefined()
    expect(alignmentSettings({ ...env, VELA_ALIGNMENT_DIAGNOSTICS_PATH: '/evidence/alignment' })?.diagnosticsPath).toBe('/evidence/alignment')

    for (const diagnosticsPath of ['', 'relative/path']) {
      expect(() => alignmentSettings({ ...env, VELA_ALIGNMENT_DIAGNOSTICS_PATH: diagnosticsPath })).toThrow('absolute directory')
    }
  })
})

describe('alignment routes', () => {
  it('shows physical mode only for the configured selected camera with a focal length', async () => {
    const { app } = setup()
    const response = await app.inject('/api/web/rigs/rig/alignment')
    expect(response.json()).toMatchObject({ enabled: true, mode: 'physical', cameraName: 'Current imager' })
    expect(mocks.controller).not.toHaveBeenCalled()
    expect(mocks.acquisition).not.toHaveBeenCalled()
  })
  it.each([
    [withoutCamera, 'Select the configured imaging camera'],
    [{ ...rig, imagingCamera: { uniqueId: 'different', name: 'Other camera' } }, 'Select the configured imaging camera'],
    [withoutFocalLength, 'Set the effective focal length'],
    [{ ...rig, endpoint: { host: 'different', port: 11111 } }, 'not configured'],
    [{ ...rig, lastObservedInventory: { ...rig.lastObservedInventory, devices: [] } }, 'not configured'],
  ] as const)('reports unmet configuration without constructing hardware %#', async (record, reason) => {
    const { app, command } = setup([record])
    const view = (await app.inject('/api/web/rigs/rig/alignment')).json()
    expect(view.enabled).toBe(false)
    expect(view.unavailableReason).toContain(reason)
    expect((await command('start')).statusCode).toBe(409)
    expect(mocks.acquisition).not.toHaveBeenCalled()
  })
  it('honestly reports unavailable and unknown rigs', async () => {
    const { app, command } = setup([rig], false)
    expect((await app.inject('/api/web/rigs/rig/alignment')).json()).toMatchObject({ enabled: false, active: false })
    expect((await app.inject('/api/web/rigs/missing/alignment')).statusCode).toBe(404)
    expect((await command('start', 'missing')).statusCode).toBe(404)
  })
  it('keeps offline configuration independent of physical camera selection', async () => {
    const { app } = setup([offlineRig], true, 'offline')
    expect((await app.inject('/api/web/rigs/rig/alignment')).json()).toMatchObject({ enabled: true })
    expect(mocks.controller).toHaveBeenCalledTimes(1)
    expect(mocks.framing).not.toHaveBeenCalled()
    expect(mocks.controller.mock.calls[0]![0].openDiagnostics).toBeUndefined()
  })
  it.each(['offline', 'physical'] as const)('wires explicit diagnostics into %s composition', async mode => {
    const { command } = setup([rig], true, mode, '/evidence/alignment')
    await command('start')
    expect(mocks.controller.mock.calls[0]![0].openDiagnostics).toBeTypeOf('function')
  })
  it('composes physical start from current camera name, focal length, and a solver factory accepting observed field height', async () => {
    const { command, catalog, operations } = setup()
    await catalog.setImagingCamera('rig', { uniqueId: 'camera', name: 'Updated imager' })
    await catalog.setFocalLength('rig', 320)
    expect((await command('start')).statusCode).toBe(200)
    expect(mocks.physical).toHaveBeenCalledWith(
      {
        cameraId: 'camera',
        telescopeId: 'telescope',
        cameraName: 'Updated imager',
        focalLengthMm: 320,
      },
      mocks.acquisition.mock.results[0]!.value,
      mocks.framing.mock.results[0]!.value,
    )
    const [composition] = mocks.controller.mock.calls[0]!

    if (composition.mode !== 'physical') throw new Error('Expected physical composition')
    const { mode, hardware: acquisition, createSolver: solverFactory, physical } = composition
    expect(acquisition).toBe(mocks.acquisition.mock.results[0]!.value)
    expect(mode).toBe('physical')
    expect(physical).toBe(mocks.physical.mock.results[0]!.value)
    solverFactory(1.75)
    expect(mocks.solver).toHaveBeenCalledWith({ executable: '/bin/astap', catalogPath: '/stars', fieldHeightDegrees: 1.75 })
    expect(operations.owner('rig')).toBe('alignment')
    expect(operations.acquire('rig', 'capture')).toBeUndefined()
    expect((await command('start')).statusCode).toBe(409)
  })
  it('rejects another operation owner before any physical composition', async () => {
    const { command, operations } = setup()
    operations.acquire('rig', 'capture')
    expect((await command('start')).statusCode).toBe(409)
    expect(mocks.controller).not.toHaveBeenCalled()
  })
  it.each(['stop', 'finish'])('allows %s after saved camera settings change', async name => {
    const { command, catalog, operations } = setup()
    await command('start')
    await catalog.setImagingCamera('rig', { uniqueId: 'different', name: 'Changed selection' })
    expect((await command(name)).statusCode).toBe(200)
    expect(mocks.stop).toHaveBeenCalledWith(name === 'finish')
    expect(operations.owner('rig')).toBeUndefined()
  })
  it.each(['stop', 'finish'])('prevents a different configured rig from issuing %s to an active controller', async name => {
    const { command } = setup([rig, { ...rig, id: 'other', name: 'Other rig' }])
    await command('start')
    await command(name, 'other')
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.state.active).toBe(true)
  })
  it('rejects unknown and malformed commands without constructing hardware', async () => {
    const { command, operations } = setup()
    expect((await command('warp')).statusCode).toBe(404)

    for (const body of [null, [], { exposureSeconds: 5 }, 'start']) expect((await command('start', 'rig', body)).statusCode).toBe(400)
    expect(mocks.acquisition).not.toHaveBeenCalled()
    expect(operations.owner('rig')).toBeUndefined()
  })
  it('releases ownership if physical composition fails', async () => {
    const { command, operations } = setup()
    mocks.physical.mockImplementation(() => { throw new Error('Configuration changed') })
    expect((await command('start')).statusCode).toBe(409)
    expect(operations.owner('rig')).toBeUndefined()
  })
})
