import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeServices } from '@effect/platform-node'
import { Context, Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { ServiceVersion, serviceVersionOf } from './version.ts'

const versionOf = (checkout: string) => Effect.runPromise(Effect.scoped(Layer.build(serviceVersionOf(checkout).pipe(Layer.provide(NodeServices.layer)))).pipe(Effect.map(context => Context.get(context, ServiceVersion))))

describe('serviceVersionOf', () => {
  it("reads the checkout's commit", async () => {
    expect((await versionOf(fileURLToPath(new URL('../../', import.meta.url)))).commit).toMatch(/^[0-9a-f]{7,40}$/)
  })

  it('fails with a typed VersionUnknown for a folder that is not a checkout', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'vela-version-'))
    const failed = await Effect.runPromise(Effect.flip(Effect.scoped(Layer.build(serviceVersionOf(folder).pipe(Layer.provide(NodeServices.layer))))))

    expect(failed).toMatchObject({ _tag: 'VersionUnknown', checkout: folder, output: '' })
  })
})
