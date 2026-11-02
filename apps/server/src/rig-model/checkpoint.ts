import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { deserialize, serialize } from 'node:v8'
import { z } from 'zod'
import type { EventId, RigId } from '@vela/rig-events'
import type { RigModel } from '@vela/rig-model'
import { type StreamState } from './stream.js'

export const maxRigCheckpointBytes = 16 * 1024 ** 2

const manifestSchema = z.object({
  version: z.literal(1),
  slot: z.union([z.literal(0), z.literal(1)]),
  rigs: z.array(z.object({ name: z.string().regex(/^[a-f0-9]{64}$/), digest: z.string().regex(/^[a-f0-9]{64}$/) })),
  sequences: z.array(z.tuple([z.string(), z.number().int().nonnegative()])),
})

async function atomicWrite(path: string, data: Uint8Array | string) {
  const file = await open(path + '.tmp', 'w', 0o600)

  try {
    await file.writeFile(data)
    await file.sync()
  } finally { await file.close() }

  await rename(path + '.tmp', path)
}

export function checkpointStore(directory: string) {
  let slot: 0 | 1 = 0

  return {
    async load(): Promise<StreamState | undefined> {
      try {
        const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8')))
        const rigs = new Map<RigId, { model: RigModel; published: EventId | null }>()

        for (const { name, digest } of manifest.rigs) {
          const path = join(directory, `${name}.${manifest.slot}.bin`)

          if ((await stat(path)).size > maxRigCheckpointBytes) throw new Error('Oversized model checkpoint')
          const data = await readFile(path)

          if (createHash('sha256').update(data).digest('hex') !== digest) throw new Error('Corrupt model checkpoint')
          const [rig, state] = deserialize(data)

          rigs.set(rig, state)
        }

        slot = manifest.slot

        return { rigs, sequences: new Map(manifest.sequences) }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EACCES') throw error

        return undefined
      }
    },
    async save(state: StreamState) {
      await mkdir(directory, { recursive: true })
      const nextSlot = slot === 0 ? 1 : 0
      const names: { name: string; digest: string }[] = []

      for (const [rig, value] of state.rigs) {
        const data = serialize([rig, value])

        if (data.byteLength > maxRigCheckpointBytes) throw new Error('Model checkpoint exceeds 16 MiB per rig')
        const name = createHash('sha256').update(rig).digest('hex')

        names.push({ name, digest: createHash('sha256').update(data).digest('hex') })
        await atomicWrite(join(directory, `${name}.${nextSlot}.bin`), data)
      }

      const directoryHandle = await open(directory, 'r')

      try { await directoryHandle.sync() } finally { await directoryHandle.close() }

      await atomicWrite(join(directory, 'checkpoint.json'), JSON.stringify({ version: 1, slot: nextSlot, rigs: names, sequences: [...state.sequences] }))
      const handle = await open(directory, 'r')

      try { await handle.sync() } finally { await handle.close() }

      slot = nextSlot
    },
  }
}
