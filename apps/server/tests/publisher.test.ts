import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { epochMs, rigId, seal, sourceId } from '@vela/rig-events'
import { expect, it } from 'vitest'
import { openPublisher } from '../src/run-log/publisher.js'

it('bounds both bytes and count and redacts credential failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'publisher-limits-'))
  const credentialsFile = join(directory, 'private.json')

  await writeFile(credentialsFile, 'invalid-private-content')

  const publisher = openPublisher({ url: 'nats://127.0.0.1:1', credentialsFile,
    limits: { count: 3, bytes: 1000, messageBytes: 1000 } })

  const event = seal({ kind: 'gap', rig: rigId('fixture'), source: sourceId('test:publisher'), at: epochMs(1000), seenAt: epochMs(1000),
    body: { source: sourceId('test:publisher'), from: epochMs(1000), to: epochMs(1001), reason: 'dropped', dropped: 1 } })

  try {
    for (let n = 0; n < 100; n++) publisher.append(event)
    expect(publisher.health().queued).toBeLessThanOrEqual(3)
    expect(publisher.health().queuedBytes).toBeLessThanOrEqual(1000)
    expect(publisher.health().queued + publisher.health().dropped).toBe(100)
    await expect.poll(() => publisher.health().lastError).not.toBe(null)
    expect(JSON.stringify(publisher.health())).not.toContain('invalid-private-content')
  } finally {
    await publisher.close()
    await rm(directory, { recursive: true, force: true })
  }
})
