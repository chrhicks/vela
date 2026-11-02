import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { encodeEvent, epochMs, seal } from '@vela/rig-events'
import { session, s } from '../../../packages/rig-model/test/support.js'
import { recoverFacts } from '../src/rig-model/recovery.js'

it('recovers an archive larger than the process heap using only a disposable location index', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'model-large-archive-'))
  const archive = join(directory, 'archive')
  const state = join(directory, 'state')
  const kind = join(archive, new Date(s(0)).toISOString().slice(0, 10), 'session')

  await mkdir(kind, { recursive: true })
  const file = await open(join(kind, 'reversed.jsonl'), 'w')
  const base = session(s(0))

  if (base.kind !== 'session') throw new Error('Expected session fixture')
  const { id: _id, v: _v, ...draft } = base

  try {
    for (let sequence = 400; sequence > 0; sequence--) {
      const event = seal({ ...draft, at: epochMs(s(sequence)), seenAt: epochMs(s(sequence)), body: { ...base.body, setupId: String(sequence), note: String(sequence) + 'x'.repeat(400000) } })

      await file.write(encodeEvent({ ...event, broker: { stream: 'RIG_FACTS', sequence } }) + '\n')
    }
  } finally { await file.close() }

  try {
    const bytes = (await stat(join(kind, 'reversed.jsonl'))).size

    const result = execFileSync(process.execPath, ['--max-old-space-size=64', '--import', createRequire(import.meta.url).resolve('tsx'),
      fileURLToPath(new URL('./fixtures/model-recovery.ts', import.meta.url)), archive, state, '400'], { encoding: 'utf8', timeout: 30000 })

    expect(JSON.parse(result)).toEqual({ count: 400, sequence: 400 })
    expect(bytes).toBeGreaterThan(2 * 64 * 1024 ** 2)
    expect(await readdir(state)).toEqual([])

    const iterator = recoverFacts(archive, state, 10)
    const first = await iterator.next()

    expect(first.value?.broker?.sequence).toBe(1)
    await iterator.return()
    expect(await readdir(state)).toEqual([])
    console.log(JSON.stringify({ archiveBytes: bytes, heapMiB: 64, recovered: 400, metadataRemoved: true }))
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)
