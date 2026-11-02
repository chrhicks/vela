import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeEvent, epochMs, rigId, seal, sourceId } from '@vela/rig-events'
import { expect, it } from 'vitest'
import { readArchive, writeArchiveBatch } from '../src/run-log/archive.js'

it('replays committed JSONL once across redelivery, filtering event time and kind and ignoring torn temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-'))

  const events = [1000, 2000, 86401000].map(at => seal({ kind: 'cria.stream', rig: rigId('fixture'), source: sourceId('fixture'),
    at: epochMs(at), seenAt: epochMs(at), body: { origin: 'http://fixture.test', event: 'opened', message: null } }))

  try {
    await writeArchiveBatch(directory, events)
    await writeArchiveBatch(directory, events)
    const path = join(directory, '1970-01-01', 'cria.stream')

    await writeFile(join(path, 'torn.tmp'), '{"v":')
    const result = await Array.fromAsync(readArchive(directory, { from: 2000, to: 86401000, kinds: ['cria.stream'] }))

    expect(result.map(event => event.id).sort()).toEqual(events.slice(1).map(event => event.id).sort())
    expect(await Array.fromAsync(readArchive(directory, { from: 0, to: 86401000, kinds: ['gap'] }))).toEqual([])
    await writeFile(join(path, 'broken.jsonl'), encodeEvent(events[0]!) + '\n{\n')
    await expect(Array.fromAsync(readArchive(directory, { from: 0, to: 86401000 }))).rejects.toThrow('Invalid archive envelope')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('fails a write when storage cannot create an archive, leaving acknowledgement to the caller', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-error-'))

  try {
    await mkdir(join(directory, '1970-01-01'))
    await writeFile(join(directory, '1970-01-01', 'cria.stream'), 'not a directory')

    const event = seal({ kind: 'cria.stream', rig: rigId('fixture'), source: sourceId('fixture'),
      at: epochMs(1000), seenAt: epochMs(1000), body: { origin: 'http://fixture.test', event: 'opened', message: null } })

    await expect(writeArchiveBatch(directory, [event])).rejects.toThrow()
  } finally { await rm(directory, { recursive: true, force: true }) }
})
