import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createEvidenceReader } from './evidence.ts'

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const temporary = await mkdtemp(join(tmpdir(), 'standards-evidence-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'repo')
  await mkdir(root)
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  await writeFile(join(root, '.gitignore'), 'ignored.ts\nignored/\n')
  const controller = new AbortController()
  const reader = await createEvidenceReader(root, controller.signal)
  return { root, temporary, reader, controller }
}

test('retains full original UTF-8 sources once with exact hashes and independent copies', async t => {
  const { root, reader } = await fixture(t)
  const code = '\uFEFFfirst\r\nconst sky = "é🌙"\r\nlast\n'
  await writeFile(join(root, 'source.ts'), code)
  await writeFile(join(root, 'empty.md'), '')
  assert.deepEqual(reader.snapshots(), [])
  const source = await reader.read('./source.ts')
  const expected = {
    path: 'source.ts',
    code,
    sha256: createHash('sha256').update(code).digest('hex'),
  }
  assert.deepEqual(source, expected)
  assert.deepEqual(await reader.read('source.ts'), expected)
  const empty = await reader.read('empty.md')
  assert.deepEqual(empty, {
    path: 'empty.md',
    code: '',
    sha256: createHash('sha256').update('').digest('hex'),
  })
  source.code = 'caller mutation'
  const snapshots = reader.snapshots()
  snapshots[0].path = 'wrong.ts'
  snapshots[0].sha256 = 'wrong'
  snapshots[0].code = 'wrong'
  snapshots.pop()
  assert.deepEqual(reader.snapshots(), [expected, empty])
  await reader.validate()
  assert.deepEqual(reader.snapshots(), [expected, empty])
})

test('rejects ignored and credential paths, outside paths, malformed paths, and symlink aliases', async t => {
  const { root, temporary, reader } = await fixture(t)
  await mkdir(join(root, 'ignored'))
  await mkdir(join(root, 'visible'))
  await writeFile(join(root, 'ignored.ts'), 'hidden')
  await writeFile(join(root, 'ignored/contract.md'), 'hidden')
  await writeFile(join(root, 'visible/source.ts'), 'visible')
  for (const name of ['credentials.json', '.env.json', 'secrets.yaml', 'service-account.json', 'id_ed25519.txt']) {
    await writeFile(join(root, name), 'hidden')
    await assert.rejects(reader.read(name), /outside the allowed/)
  }
  await writeFile(join(temporary, 'outside.ts'), 'outside')
  await symlink(join(temporary, 'outside.ts'), join(root, 'outside.ts'))
  await symlink(join(root, 'visible/source.ts'), join(root, 'alias.ts'))
  await symlink(join(root, 'visible'), join(root, 'alias-dir'))
  await symlink(temporary, join(root, 'outside-dir'))
  for (const path of ['ignored.ts', 'ignored/contract.md']) {
    await assert.rejects(reader.read(path), /Git-ignored/)
  }
  for (const path of ['outside.ts', 'alias.ts', 'alias-dir/source.ts', 'outside-dir/outside.ts']) {
    await assert.rejects(reader.read(path), /symlinks/)
  }
  for (const path of [
    '',
    'bad\0.ts',
    '../outside.ts',
    join(root, 'visible/source.ts'),
    '.git/config',
    'credentials/../visible/source.ts',
  ]) {
    await assert.rejects(reader.read(path), /checkout-relative|outside the allowed/)
  }
  assert.deepEqual(reader.snapshots(), [])
  assert.equal((await reader.read('visible/source.ts')).code, 'visible')
})

test('checks ignore rules even for tracked files and fails closed outside a Git repository', async t => {
  const { root, temporary, reader } = await fixture(t)
  await writeFile(join(root, 'ignored.ts'), 'hidden')
  execFileSync('git', ['add', '--force', '--', 'ignored.ts'], { cwd: root })
  await assert.rejects(reader.read('ignored.ts'), /Git-ignored/)
  await writeFile(join(temporary, 'outside.ts'), 'outside')
  const outside = await createEvidenceReader(temporary, new AbortController().signal)
  await assert.rejects(outside.read('outside.ts'), /Cannot check Git ignore rules/)
  assert.deepEqual(outside.snapshots(), [])
})

test('refuses changed source on reread without replacing the original snapshot', async t => {
  const { root, reader } = await fixture(t)
  await writeFile(join(root, 'source.ts'), 'old\n')
  const original = await reader.read('source.ts')
  await writeFile(join(root, 'source.ts'), 'new\n')
  await assert.rejects(reader.read('source.ts'), /source changed/)
  await assert.rejects(reader.validate(), /changed or became unavailable: source.ts/)
  assert.deepEqual(reader.snapshots(), [original])
})

test('validation rejects deletion, newly ignored files, links, and same-content replacements', async t => {
  for (const change of ['delete', 'ignore', 'link', 'replace', 'ancestor-link']) {
    await t.test(change, async t => {
      const { root, temporary, reader } = await fixture(t)
      await mkdir(join(root, 'source'))
      const name = 'source/file.ts'
      const path = join(root, name)
      await writeFile(path, 'original')
      const original = await reader.read(name)
      if (change === 'delete') await rm(path)
      if (change === 'ignore') await writeFile(join(root, '.gitignore'), `${name}\n`)
      if (change === 'link') {
        await writeFile(join(temporary, 'file.ts'), 'original')
        await rm(path)
        await symlink(join(temporary, 'file.ts'), path)
      }
      if (change === 'replace') {
        await writeFile(join(root, 'replacement.ts'), 'original')
        await rename(join(root, 'replacement.ts'), path)
      }
      if (change === 'ancestor-link') {
        await rename(join(root, 'source'), join(root, 'moved'))
        await symlink(join(root, 'moved'), join(root, 'source'))
      }
      await assert.rejects(reader.validate(), /changed or became unavailable: source\/file.ts/)
      assert.deepEqual(reader.snapshots(), [original])
    })
  }
})

test('applies the 40000-byte limit to every source without clipping or a cumulative budget', async t => {
  const { root, reader } = await fixture(t)
  const code = '🌙'.repeat(10_000)
  for (const name of ['first.ts', 'second.md', 'third.json']) {
    await writeFile(join(root, name), code)
    assert.equal((await reader.read(name)).code, code)
  }
  await writeFile(join(root, 'oversize.ts'), code + 'a')
  await assert.rejects(reader.read('oversize.ts'), /exceeds 40000 bytes/)
  assert.equal(reader.snapshots().length, 3)
  await reader.validate()
})

test('rejects binary, invalid UTF-8, unsupported, directory, and FIFO sources without retaining them', { timeout: 5000 }, async t => {
  const { root, reader } = await fixture(t)
  await writeFile(join(root, 'binary.ts'), Buffer.from([97, 0, 98]))
  await writeFile(join(root, 'invalid.ts'), Buffer.from([0xc3, 0x28]))
  await writeFile(join(root, 'picture.svg'), '<svg/>')
  await mkdir(join(root, 'directory.ts'))
  execFileSync('mkfifo', [join(root, 'pipe.ts')])
  for (const [path, error] of [
    ['binary.ts', /binary/],
    ['invalid.ts', /UTF-8/],
    ['picture.svg', /Unsupported/],
    ['directory.ts', /regular/],
    ['pipe.ts', /regular/],
  ] as const) {
    await assert.rejects(reader.read(path), error)
  }
  assert.deepEqual(reader.snapshots(), [])
})

test('cancellation stops pending and subsequent access while preserving collected snapshots', async t => {
  const { root, reader, controller } = await fixture(t)
  await writeFile(join(root, 'source.ts'), 'source')
  const original = await reader.read('source.ts')
  const pending = reader.read('source.ts')
  controller.abort(new Error('review canceled'))
  await assert.rejects(pending, /review canceled/)
  await assert.rejects(reader.read('source.ts'), /review canceled/)
  await assert.rejects(reader.validate(), /review canceled/)
  await assert.rejects(createEvidenceReader(root, controller.signal), /review canceled/)
  assert.deepEqual(reader.snapshots(), [original])
})
