import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const git = promisify(execFile)

export class OutputInRepositoryError extends Error {}

/**
 * A package or a recording holds the observing site, so it must not land where `git add` would pick it up.
 * Refuses an output folder inside a git working tree unless git ignores what would be written there.
 * `allowInRepo` is the one deliberate way past it.
 */
export async function refuseOutputInRepository(directory: string, allowInRepo: boolean): Promise<void> {
  if (allowInRepo) return

  const target = resolve(directory)
  const base = nearestExisting(target)
  const real = join(await realpath(base), relative(base, target))

  if ((await run(base, ['rev-parse', '--show-toplevel'])) === null) return

  for (const written of [join(real, 'package'), join(real, 'builds', 'x')]) {
    if ((await run(base, ['check-ignore', '-q', '--', written])) === null) {
      throw new OutputInRepositoryError(
        'refusing to write a package into an output folder inside a git working tree that git does not ignore. ' +
          'A package holds the observing site and must not be committed. Use a folder outside every repository (for example ~/.local/share/rig-sessions/<name>), ignore the folder, or pass --allow-in-repo.',
      )
    }
  }
}

function nearestExisting(path: string): string {
  return existsSync(path) ? path : nearestExisting(dirname(path))
}

/** The command's output, or null when git failed or says no (`check-ignore` exits 1 for a path that is not ignored). */
async function run(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    return (await git('git', ['-C', cwd, ...args])).stdout
  } catch {
    return null
  }
}
