import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readJournal } from './journal.ts'

const exchange = {
  kind: 'exchange',
  at: Date.parse('2030-01-01T01:00:00Z'),
  ms: 11,
  method: 'POST',
  route: '/v2/operations',
  status: 202,
  command: { requestId: 'request-1', deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 50 } },
  reply: { kind: 'answered', body: { id: 'operation-1' } },
  origin: 'http://cria.example.test:4319',
}

const image = { kind: 'image', at: Date.parse('2030-01-01T01:01:00Z'), imageId: 'image-1', operationId: 'operation-1', bytes: 5000, sha256: 'sha', verdict: 'intact', origin: 'x' }

test('the journal reads exchanges and image checks, passes over other kinds, and lists the lines it cannot read', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'rig-session-journal-')), 'cria-journal.jsonl')

  await writeFile(
    file,
    [
      exchange,
      { kind: 'state', at: 1, changed: {} },
      { kind: 'stream', at: 2, event: 'opened', message: null },
      image,
      { ...image, verdict: 'vanished' },
      { ...exchange, reply: { kind: 'lost', message: 'reset' }, status: null, command: null },
    ]
      .map(line => `${JSON.stringify(line)}\n`)
      .join('') + '{"kind":"image","at":',
  )

  const { items, skipped } = await readJournal(file)

  expect(items.map(entry => entry.kind)).toEqual(['exchange', 'image', 'exchange'])
  expect(JSON.stringify(items)).not.toContain('example.test')
  expect(skipped.map(entry => entry.where)).toEqual([`${file}:5`, `${file}:7`])
})
