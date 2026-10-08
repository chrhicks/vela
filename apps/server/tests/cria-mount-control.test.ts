import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { CriaClient } from '@vela/cria'
import { reading, ServiceFixture, serviceOrigin, token } from '../../../packages/cria/test/fixture.js'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createCriaCustody } from '../src/cria/custody.js'
import { createMemoryAcquisitionArchive } from '../src/acquisitions/archive.js'


function fixture() {
  const service = new ServiceFixture()
  Object.assign(service.mount.fields, {
    parked: reading(false), tracking: reading(false), slewing: reading(false),
    canUnpark: reading(true), canSetTracking: reading(true),
  })

  const client = new CriaClient({
    baseUrl: serviceOrigin, token, storeId: service.state.storeId,
    devices: service.state.devices.map(({ id, kind, expectedName }) => ({ id, kind, expectedName })),
    fetch: service.fetch, observationTimeoutMs: 100, pollIntervalMs: 1,
  })

  onTestFinished(() => client.close())

  const control = createCriaEquipment(client, [{
    providerDeviceId: 'mount-id', id: 'mount', kind: 'mount', expectedName: 'Fixture mount',
  }], createCriaCustody(client, createMemoryAcquisitionArchive(), service.state.storeId)).mountControl

  return { service, control }
}

const trackingOn = { telescopeId: 'mount-id', kind: 'set-tracking', tracking: true } as const

describe('Cria mount controls', () => {
  it('waits for fresh post-write dynamic facts after the terminal event, using only SSE state', async () => {
    const { service, control } = fixture()
    service.completeImmediately = false
    let completed = false

    const command = control.execute(trackingOn).then(result => { completed = true;

 return result })

    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    service.finish()
    service.mount.fields.tracking = { ...reading(true), generation: service.mount.observationGeneration - 1 }
    await service.publish()
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(completed).toBe(false)
    service.mount.fields.tracking = { ...reading(true), generation: service.mount.observationGeneration }
    await service.publish()
    expect(await command).toMatchObject({ outcome: 'confirmed', observation: { tracking: true } })
    expect(service.paths.filter(path => path.startsWith('GET '))).toEqual(['GET /v2/events'])
    expect(service.posts).toHaveLength(1)
  })

  it.each([false, true])('unparks explicitly and reports tracking=%s from readback', async tracking => {
    const { service, control } = fixture()
    service.mount.fields.parked = reading(true)
    service.mount.fields.tracking = reading(false)
    service.completeImmediately = false
    const command = control.execute({ telescopeId: 'mount-id', kind: 'unpark' })
    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    expect(JSON.parse(service.posts[0]!)).toMatchObject({ kind: 'mount-unpark', parameters: {} })
    service.mount.fields.parked = reading(false)
    service.mount.fields.tracking = reading(tracking)
    service.finish()
    expect(await command).toMatchObject({ outcome: 'confirmed', observation: { parked: false, tracking } })
    expect(service.posts).toHaveLength(1)
  })

  it('keeps unknown facts unknown and rejects moving, parked and unsupported writes', async () => {
    const { service, control } = fixture()
    service.mount.fields.parked = reading(true)
    expect(await control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'parked' })
    service.mount.fields.parked = reading(false)
    service.mount.fields.slewing = reading(true)
    await service.publish()
    expect(await control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'busy' })
    service.mount.fields.slewing = reading(false)
    service.mount.fields.canSetTracking = { ...reading(null), status: 'unsupported' }
    await service.publish()
    expect((await control.observe('mount-id'))?.canSetTracking).toBeUndefined()
    expect(await control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'unavailable' })
    service.mount.fields.canSetTracking = reading(false)
    await service.publish()
    expect(await control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'unsupported' })
    expect(service.posts).toHaveLength(0)
  })

  it('does not reconcile unresolved controller operations or replay uncertain commands', async () => {
    const { service, control } = fixture()
    service.completeImmediately = false
    const command = control.execute(trackingOn)
    await vi.waitFor(() => expect(service.posts).toHaveLength(1))
    service.finish('uncertain')
    expect(await command).toMatchObject({ outcome: 'uncertain', reason: 'write-outcome-unknown' })
    expect(await control.observe('mount-id')).toBeUndefined()
    expect(service.posts).toHaveLength(1)
  })

  it.each([
    { reconciled: false, blocked: false, available: false },
    { reconciled: true, blocked: true, available: false },
    { reconciled: true, blocked: false, available: true },
  ])('honors explicit external recovery without clearing a retained block: %j', async ({ reconciled, blocked, available }) => {
    const { service, control } = fixture()

    // Seed history before this client connects, as after an operator-coordinated restart.
    await service.fetch(`${serviceOrigin}/v2/operations`, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requestId: randomUUID(), instanceId: randomUUID(), deviceId: 'mount',
        bindingId: randomUUID(), expectedName: service.mount.expectedName,
        kind: 'mount-tracking', parameters: { tracking: true },
      }),
    })
    const historical = service.finish('uncertain')
    historical.blocksDevice = blocked
    historical.reconciliation = reconciled
      ? { at: service.state.generatedAt, externalRecoveryConfirmed: true, note: 'Previous owner exited; external read confirms tracking off and no slew.' }
      : null
    await service.publish()

    if (available) {
      expect(await control.observe('mount-id')).toMatchObject({ tracking: false, slewing: false })
      service.completeImmediately = false
      const command = control.execute(trackingOn)
      await vi.waitFor(() => expect(service.posts).toHaveLength(2))
      service.mount.fields.tracking = reading(true)
      service.finish()
      expect(await command).toMatchObject({ outcome: 'confirmed', observation: { tracking: true } })
    } else {
      expect(await control.observe('mount-id')).toBeUndefined()
      expect(await control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'unavailable' })
      expect(service.posts).toHaveLength(1)
    }

    expect(historical).toMatchObject({ status: 'uncertain', settled: false, blocksDevice: blocked })
    expect(service.paths.filter(path => path.startsWith('GET '))).toEqual(['GET /v2/events'])
  })
})
