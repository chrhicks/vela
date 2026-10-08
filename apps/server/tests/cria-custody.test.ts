import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { CriaClient, CriaUncertainError } from '@vela/cria'
import { ServiceFixture, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createCriaCustody } from '../src/cria/custody.js'
import { createMemoryAcquisitionArchive, type AcquisitionArchive } from '../src/acquisitions/archive.js'

function setup(service: ServiceFixture, archive: AcquisitionArchive = createMemoryAcquisitionArchive(), fetch = service.fetch) {
  const bindings = service.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName, providerDeviceId: id }))

  const client = new CriaClient({
    baseUrl: serviceOrigin,
    token,
    storeId: service.state.storeId,
    devices: bindings.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    fetch,
    pollIntervalMs: 1,
    operationTimeoutMs: 1000,
    imageRetryMs: 30,
  })

  onTestFinished(() => client.close())
  const custody = createCriaCustody(client, archive, service.state.storeId)

  return { client, custody, archive, equipment: createCriaEquipment(client, bindings, custody) }
}

const request = { cameraId: 'camera', exposureSeconds: 0.001 } as const

describe('acquisition custody through the Cria adapter', () => {
  it('archives the exact original and its purpose before the consumer receives pixels', async () => {
    const service = new ServiceFixture()
    const { equipment, archive } = setup(service)
    const frame = await equipment.acquisition.capture({ ...request, purpose: 'autofocus' })
    const record = [...service.custody.values()][0]!

    expect(frame.pixels.length).toBe(6)
    expect(record.state).toBe('archived')
    expect(service.receipts).toHaveLength(1)
    expect((await archive.receipt(record.storeId, record.id))?.receiptId).toBe(record.receipt?.receiptId)
    expect((await archive.unacknowledged()).receipts).toEqual([])
    expect(service.paths.some(path => path.startsWith('DELETE'))).toBe(false)
  })

  it('returns pixels when the archive fails and later archives the same original without exposing again', async () => {
    const service = new ServiceFixture()
    const working = createMemoryAcquisitionArchive()
    const broken: AcquisitionArchive = { ...working, preserve: async () => { throw new Error('Archive disk unavailable') } }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = setup(service, broken)

    expect((await failing.equipment.acquisition.capture(request)).pixels.length).toBe(6)
    expect(error).toHaveBeenCalled()
    expect([...service.custody.values()][0]!.state).toBe('retained')

    const report = await setup(service, working).custody.recover()

    expect(report).toMatchObject({ preserved: 1, problems: [] })
    expect([...service.custody.values()][0]!.state).toBe('archived')
    expect(service.posts).toHaveLength(1)
    error.mockRestore()
  })

  it('resends the same verified receipt after a lost acknowledgement response', async () => {
    const service = new ServiceFixture()
    const archive = createMemoryAcquisitionArchive()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let dropped = false

    const lossy = setup(service, archive, async (input, init) => {
      const response = await service.fetch(input, init)

      if (!dropped && String(input).endsWith('/archive-receipt')) {
        dropped = true
        throw new TypeError('Response lost')
      }

      return response
    })

    await lossy.equipment.acquisition.capture(request)
    const record = [...service.custody.values()][0]!

    expect(record.state).toBe('archived')
    expect((await archive.unacknowledged()).receipts).toHaveLength(1)
    expect(await setup(service, archive).custody.recover()).toMatchObject({ acknowledged: 1, problems: [] })
    expect(new Set(service.receipts)).toEqual(new Set([record.receipt!.receiptId]))
    expect((await archive.unacknowledged()).receipts).toEqual([])
    error.mockRestore()
  })

  it('archives a verified result whose operation stayed uncertain, leaving the interlock in place', async () => {
    const service = new ServiceFixture()

    service.completeImmediately = false
    const { equipment, custody, client } = setup(service)
    const capturing = equipment.acquisition.capture(request)

    await vi.waitFor(() => expect(service.last).not.toBeNull())
    const operation = service.finish('uncertain')

    await expect(capturing).rejects.toBeInstanceOf(CriaUncertainError)
    service.retain(operation)
    expect(await custody.recover()).toMatchObject({ preserved: 1, problems: [] })
    expect(service.custody.get(operation.reservedImageId!)?.state).toBe('archived')
    expect(client.commandBlockReasonFor('camera')).not.toBeNull()
    expect(service.posts).toHaveLength(1)
  })
})
