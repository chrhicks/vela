/** Run after pnpm build with the Cria worktree as the only argument. Uses loopback fakes only. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { Effect } from 'effect'

if (process.argv[2] === '--holder') {
  const { createCriaConnection } = await import('../dist/connection.js')
  const { createCriaEquipment } = await import('../dist/v5/equipment.js')
  const connection = createCriaConnection({ origin: process.argv[3] })
  const session = connection.session()

  while (Effect.runSync(session.received).state !== 'live') await new Promise(resolve => setTimeout(resolve, 20))
  const rig = createCriaEquipment(session, [{ deviceId: 'test-mount', criaDeviceId: 'mount', expectedName: 'ZWO AM5' }])
  await Effect.runPromise(rig.run('test-mount', { kind: 'mount-slew', parameters: { rightAscensionDegrees: 120, declinationDegrees: 10, coordinateSystem: 'topocentric' } }))
  throw new Error('Move completed before SIGKILL')
} else {
  const root = process.argv[2]

  if (!root) throw new Error('Usage: node --conditions=@cria/source --import CRIA/ts/testing/source-hook.mjs packages/cria/test/lease-kill.mjs CRIA')
  const load = relative => import(pathToFileURL(`${root}/${relative}`).href)
  const { FakeIndi, addMount } = await load('ts/packages/fake-indi/src/index.ts')
  const { allReady, startCria, until } = await load('ts/apps/cria/test/harness.ts')
  const { am5 } = await load('ts/apps/cria/test/drivers.ts')
  const fake = new FakeIndi()
  let cria
  let holder

  try {
    await fake.start()
    addMount(fake, 'ZWO AM5')
    const model = am5(fake, 'ZWO AM5', { publishEveryMs: 100, stopLatencyMs: 500 })
    fake.behaviour = model.behaviour
    cria = await startCria(fake.port, [{ id: 'mount', kind: 'mount', indiDevice: 'ZWO AM5', site: { latitudeDegrees: 35, longitudeDegrees: 0, elevationMeters: 0 }, motion: { positionReadMs: 250 } }], { mountLeaseRequired: true })
    await cria.waitFor(allReady(['mount']))
    holder = spawn(process.execPath, [import.meta.filename, '--holder', cria.base], { stdio: ['ignore', 'inherit', 'inherit'] })
    const operation = await until('Vela to start a leased goto', async () => (await cria.state()).operations.find(operation => operation.kind === 'mount-slew' && operation.state === 'running' && operation.leaseId))
    await until('mount to start moving', () => fake.vector('ZWO AM5', 'EQUATORIAL_EOD_COORD').state === 'Busy')
    await new Promise(resolve => setTimeout(resolve, 1500))
    assert.equal((await cria.client.operation(operation.id)).body.state, 'running', 'Vela renewed beyond the initial lease')
    const exited = once(holder, 'exit')
    const killedAt = Date.now()
    holder.kill('SIGKILL')
    await exited
    const ending = await cria.settled(operation.id, 10_000)
    assert.equal(ending.kind, 'stopped')
    assert.equal(ending.quarantined, false)
    assert.equal(ending.operation.motion.stopped.how, 'aborted')
    assert.match(ending.operation.motion.stopped.reason, /lease expired for vela/)
    assert(fake.received.some(xml => xml.startsWith('<new') && xml.includes('name="TELESCOPE_ABORT_MOTION"')))
    console.log(JSON.stringify({ result: 'PASS', killedPid: holder.pid, elapsedMs: Date.now() - killedAt, operation: ending.operation }, null, 2))
  } finally {
    if (holder && holder.exitCode === null && holder.signalCode === null) { const exited = once(holder, 'exit'); holder.kill('SIGTERM'); await exited }

    await cria?.stop()
    await fake.stop()
  }
}
