import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { criaProgram, openCriaCheckout } from './cria-checkout.ts'

let root: string

let pin: string

const git = (...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8' }).trim()

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cria-checkout-'))
  await mkdir(join(root, 'ts', 'node_modules'), { recursive: true })
  await writeFile(join(root, 'ts', 'package.json'), '{}')
  git('init', '-q')
  git('add', 'ts/package.json')
  git('commit', '-q', '-m', 'one')
  pin = git('rev-parse', 'HEAD')
})

afterEach(() => rm(root, { recursive: true, force: true }))

test('a clean, installed checkout at the pin is accepted', async () => {
  expect(await openCriaCheckout(root, pin)).toEqual({ ts: join(root, 'ts'), commit: pin })
})

test('another commit is refused with both commits named', async () => {
  await writeFile(join(root, 'ts', 'package.json'), '{"a":1}')
  git('commit', '-q', '-am', 'two')

  await expect(openCriaCheckout(root, pin)).rejects.toThrow(`is at ${git('rev-parse', 'HEAD')}, not the pinned ${pin}`)
})

test('a changed tracked file under ts/ is refused, and a new untracked file is not', async () => {
  await writeFile(join(root, 'ts', 'untracked.ts'), '')
  await expect(openCriaCheckout(root, pin)).resolves.toMatchObject({ commit: pin })

  await writeFile(join(root, 'ts', 'package.json'), '{"edited":true}')
  await expect(openCriaCheckout(root, pin)).rejects.toThrow('has changes under ts/')
})

test('a checkout that was not installed is refused with the command to run', async () => {
  await rm(join(root, 'ts', 'node_modules'), { recursive: true })

  await expect(openCriaCheckout(root, pin)).rejects.toThrow('pnpm install --frozen-lockfile')
})

test('no path, or a folder that is not a Git checkout, is refused naming CRIA_CHECKOUT', async () => {
  await expect(openCriaCheckout(undefined, pin)).rejects.toThrow('Set CRIA_CHECKOUT')
  await expect(openCriaCheckout(await mkdtemp(join(tmpdir(), 'not-git-')), pin)).rejects.toThrow('is not a Git checkout of Cria')
})

test('Cria and indi-replay run from source with the checkout\'s conditions and module hook', () => {
  const checkout = { ts: '/c/ts', commit: pin }

  expect(criaProgram(checkout, 'cria').args).toEqual([
    '--conditions=@cria/source',
    '--import',
    '/c/ts/testing/source-hook.mjs',
    '/c/ts/apps/cria/src/main.ts',
  ])
  expect(criaProgram(checkout, 'indi-replay').args.at(-1)).toBe('/c/ts/packages/indi-replay/src/main.ts')
})
