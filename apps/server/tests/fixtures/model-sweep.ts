import { setImmediate } from 'node:timers/promises'
import { FakeCria } from '../../../../packages/cria/test/v5/fake-cria.js'
import { createEquipmentComposition } from '../../src/equipment/composition.js'
import { buildApp } from '../../src/app.js'
import { createMemoryRigCatalog } from '../../src/rig/catalog.js'
import { frame, imageIdOf, inOrder, snapshot, solved, steady, testRig, mountReadings } from '@vela/rig-testing'
import { createModelHost, modelRunLog } from '../../src/rig-model/host.js'
import { openRunLog } from '../../src/run-log/run-log.js'

const directory = process.argv[2]!

const start = Date.UTC(2026, 10, 1)

const service = new FakeCria()

service.deviceView = device => device.kind === 'mount' ? { ...device, readings: mountReadings({ at: start + 14_000, raHours: 3, decDegrees: 0, frame: 'j2000', slewing: true }) } : device

const host = createModelHost(undefined, () => start + 20_000)

await host.ready

const log = modelRunLog(openRunLog({ directory, maxFileBytes: 12_000 }), host)

const image = imageIdOf(1)

for (const event of inOrder(
  steady({ from: start, to: start + 10_000, instanceId: service.instanceId, bindingId: service.bindingOf('mount'), mount: { at: start, raHours: 2, decDegrees: 0, frame: 'j2000' } }),
  frame({ image, capturedAt: start + 1000, exposureSeconds: 2, seenAt: start + 3000 }),
  solved(image, { raDegrees: 30.001, decDegrees: 0 }, start + 4000),
  snapshot({ at: start + 13_000, instanceId: service.instanceId, bindingId: service.bindingOf('mount'), mount: { at: start + 13_000, raHours: 3, decDegrees: 0, frame: 'j2000', slewing: true } }),
)) log.append(event)

const equipment = createEquipmentComposition([{ id: testRig, name: 'Synthetic', url: service.origin, devices: [{ id: 'mount', kind: 'mount', expectedName: 'ZWO AM5' }] }], { fetch: service.fetch, runLog: log })

const catalog = createMemoryRigCatalog()

await catalog.add({ id: testRig, name: 'Synthetic', endpoint: { host: 'localhost', port: 1 }, inventory: { observedAt: new Date(start).toISOString(), devices: [] } })

const app = buildApp({ models: host, runLog: log, equipment, rigCatalog: catalog })

await app.listen({ host: '127.0.0.1', port: 0 })

while (!service.received.some(request => request.path === '/v2/events')) await setImmediate()

await setImmediate()

while (log.health().pendingBytes > 0) await setImmediate()

process.send?.({ assessment: host.get(testRig), instanceId: service.instanceId, bindingId: service.bindingOf('mount') })

process.on('message', () => {})
