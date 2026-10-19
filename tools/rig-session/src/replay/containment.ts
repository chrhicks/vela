import { spawn } from 'node:child_process'
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Every file, directory and link under `roots`, by path, with the size and modification time that would change if a file was written. A directory is only its name, because adding a file already lists the file. */
export async function listing(roots: ReadonlyArray<string>): Promise<Map<string, string>> {
  const found = new Map<string, string>()

  async function visit(path: string) {
    let stat

    try {
      stat = await lstat(path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }

    found.set(path, stat.isDirectory() ? 'dir' : `${stat.size}@${stat.mtimeMs}`)

    if (stat.isDirectory()) for (const entry of await readdir(path)) await visit(join(path, entry))
  }

  for (const root of roots) await visit(resolve(root))

  return found
}

export interface Difference {
  added: string[]
  removed: string[]
  changed: string[]
}

export function difference(before: Map<string, string>, after: Map<string, string>): Difference {
  return {
    added: [...after.keys()].filter(path => !before.has(path)),
    removed: [...before.keys()].filter(path => !after.has(path)),
    changed: [...after.keys()].filter(path => before.has(path) && before.get(path) !== after.get(path)),
  }
}

export const isClean = (changes: Difference) => changes.added.length + changes.removed.length + changes.changed.length === 0

/**
 * Runs `command` with TMPDIR pointing at a fresh folder, and lists `roots` before and after. The
 * folder is the one place the command may write, and its contents are reported before it is removed.
 */
export async function checkContainment(
  command: ReadonlyArray<string>,
  roots: ReadonlyArray<string>,
): Promise<{ exitCode: number; outside: Difference; leftInTemporaryFolder: string[] }> {
  const temporary = await mkdtemp(join(tmpdir(), 'containment-'))
  const watched = roots.filter(root => resolve(root) !== temporary)
  const before = await listing(watched)
  const [program, ...args] = command

  if (!program) throw new Error('No command to run')

  const exitCode = await new Promise<number>((done, fail) => {
    const child = spawn(program, args, { stdio: 'inherit', env: { ...process.env, TMPDIR: temporary } })

    child.once('error', fail)
    child.once('close', code => done(code ?? 1))
  })

  const outside = difference(before, await listing(watched))
  const leftInTemporaryFolder = [...(await listing([temporary])).keys()].filter(path => path !== temporary)

  await rm(temporary, { recursive: true, force: true })

  return { exitCode, outside, leftInTemporaryFolder }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const separator = process.argv.indexOf('--')
  const command = process.argv.slice(separator + 1)
  const home = homedir()

  // ~/.local/share/vela is not watched by default: the live Vela on this machine writes it all day.
  const roots = process.argv.slice(2, separator).length
    ? process.argv.slice(2, separator)
    : [new URL('../../../../', import.meta.url).pathname, process.env.CRIA_CHECKOUT ?? '', join(home, '.local', 'share', 'rig-sessions'), join(home, '.config', 'vela')].filter(Boolean)

  const { exitCode, outside, leftInTemporaryFolder } = await checkContainment(command, roots)

  console.log(`\nWatched ${roots.length} roots:\n${roots.map(root => `  ${root}`).join('\n')}`)
  console.log(`Command exit code: ${exitCode}`)
  console.log(`Left in the temporary folder TMPDIR pointed at (removed now): ${leftInTemporaryFolder.length ? `\n${leftInTemporaryFolder.map(path => `  ${path}`).join('\n')}` : 'nothing'}`)
  console.log(`Outside it: ${outside.added.length} added, ${outside.removed.length} removed, ${outside.changed.length} changed`)

  for (const [label, paths] of Object.entries(outside)) for (const path of paths) console.log(`  ${label}: ${path}`)

  process.exitCode = exitCode !== 0 || !isClean(outside) ? 1 : 0
}
