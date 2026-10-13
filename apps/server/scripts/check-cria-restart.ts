import assert from 'node:assert/strict'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { CriaClient } from '@vela/cria'
import { createCriaEquipment } from '../src/cria/equipment.js'

// One Vela client across a Cria restart. A driver script restarts Cria between the two captures
// (see Cria tests/vela_restart.py); after the restart the next workflow must run, not stay blocked.
const [path, flags] = process.argv.slice(2)

if (!path || !flags) throw new Error('Pass the fixture connection.json and a directory for hand-off files')

const connection = z.object({
  baseUrl: z.url().refine(value => new URL(value).hostname === '127.0.0.1'),
  token: z.string().min(32),
  devices: z.array(z.object({ id: z.string(), kind: z.enum(['camera', 'mount', 'focuser', 'weather', 'switch']), expectedName: z.string() })),
}).parse(JSON.parse(await readFile(path, 'utf8')))

const client = new CriaClient({ baseUrl: connection.baseUrl, token: connection.token, devices: connection.devices })

const bindings = connection.devices.map(device => ({ ...device, providerDeviceId: `fixture:${device.id}` }))

const equipment = createCriaEquipment(client, bindings)

const capture = () => equipment.acquisition.capture({ cameraId: 'fixture:camera', exposureSeconds: 0.1 })

client.start()

assert.ok((await capture()).width > 0)

await writeFile(join(flags, 'first-capture-done'), '')

for (;;) {
  try {
    await access(join(flags, 'cria-restarted'))
    break
  } catch {
    await delay(100)
  }
}

console.log('PASS capture before the restart')

// Cria needs a moment to bring its devices up again; a client that stays blocked never recovers.
const deadline = Date.now() + 60_000

let last: unknown

for (;;) {
  try {
    assert.ok((await capture()).width > 0)
    break
  } catch (error) {
    last = error

    if (Date.now() > deadline) throw last
    await delay(500)
  }
}

console.log('PASS the next capture runs against the restarted Cria')

await client.close()
