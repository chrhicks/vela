import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

/**
 * The Cria commit Vela checks its client against, and the blob that commit holds at
 * ts/testing/golden/wire.golden.json. Change them together with the two `@cria/*` pins in
 * pnpm-workspace.yaml and the copy at test/v5/wire.golden.json. Cria's own file at a commit:
 * `git -C CRIA rev-parse COMMIT:ts/testing/golden/wire.golden.json`.
 */
const golden = {
  commit: '744840121be962952e4f1b78e968c4810341ad95',
  blob: '71ff9bcef82170b26c55cb986c5bfca8282cd849',
}

const workspace = readFileSync(new URL('../../../pnpm-workspace.yaml', import.meta.url), 'utf8')

// What `git hash-object` prints: SHA-1 of "blob <byte length>\0" followed by the file's bytes.
function blobOf(path: URL): string {
  const bytes = readFileSync(path)

  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

it('names one Cria commit in both @cria/* pins', () => {
  const pins = [...workspace.matchAll(/^\s+'(@cria\/[^']+)':\s*github:chrhicks\/cria#([0-9a-f]{40})&/gm)].map(([, name, commit]) => [name, commit])

  expect(pins.map(([name]) => name).sort()).toEqual(['@cria/primitives', '@cria/wire'])
  expect(pins.map(([, commit]) => commit)).toEqual([golden.commit, golden.commit])
})

it('keeps the golden copy byte for byte what Cria holds at that commit', () => {
  expect(blobOf(new URL('./v5/wire.golden.json', import.meta.url))).toBe(golden.blob)
})
