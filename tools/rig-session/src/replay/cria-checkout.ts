import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * The Cria commit that replay runs: the one that holds `indi-replay` and `synthesizeTape`.
 *
 * It is not the `@cria/wire` pin in `pnpm-workspace.yaml`. That pin is a git-path dependency, which
 * pnpm can install only for a package with no `workspace:` dependencies. `apps/cria` and `indi-replay`
 * depend on their sibling packages and Cria commits no `dist/` for them, so they cannot be installed
 * that way. Replay therefore runs a checkout of Cria that the caller names, and refuses it unless
 * it is exactly this commit with no local changes.
 *
 * Not older than f82674d. It holds the INDI bad-input hardening (a skipped bad update leaves one reading unavailable and
 * the device ready), which real recordings benefit from. a182aac was the oldest usable: before it, replay served the
 * definitions with no device and no name that real drivers send as one malformed light, Cria dropped the connection
 * on it, and every device of a real recording read as unavailable.
 */
export const criaPin = 'f82674d6efbc56c3f71e9533968d1f73590919fa'

export interface CriaCheckout {
  /** Cria's `ts/` folder. */
  readonly ts: string
  readonly commit: string
}

/** The node command line that runs a Cria program straight from its source. */
export function criaProgram(checkout: CriaCheckout, program: 'cria' | 'indi-replay') {
  const script = program === 'cria' ? join('apps', 'cria', 'src', 'main.ts') : join('packages', 'indi-replay', 'src', 'main.ts')

  return {
    command: process.execPath,
    args: ['--conditions=@cria/source', '--import', join(checkout.ts, 'testing', 'source-hook.mjs'), join(checkout.ts, script)],
  }
}

async function git(root: string, ...args: string[]): Promise<string> {
  try {
    return (await run('git', ['-C', root, ...args])).stdout.trim()
  } catch {
    throw new Error(`${root} is not a Git checkout of Cria. Set CRIA_CHECKOUT to one at ${criaPin}.`)
  }
}

/**
 * Accepts `path` only if it is a Cria checkout at `pin`, with no change to a tracked file under
 * `ts/`, and installed (`pnpm install --frozen-lockfile` in `ts/`). A different commit would
 * replay against code nobody reviewed with these scenarios.
 */
export async function openCriaCheckout(path: string | undefined, pin = criaPin): Promise<CriaCheckout> {
  if (!path)
    throw new Error(`Set CRIA_CHECKOUT to a checkout of chrhicks/cria at ${pin}, with \`pnpm install --frozen-lockfile\` run in its ts/ folder.`)

  const root = resolve(path)
  const commit = await git(root, 'rev-parse', 'HEAD')

  if (commit !== pin)
    throw new Error(`${root} is at ${commit}, not the pinned ${pin}. Check out the pin (git -C ${root} checkout ${pin}).`)

  if (await git(root, 'status', '--porcelain', '--untracked-files=no', '--', 'ts'))
    throw new Error(`${root} has changes under ts/. Replay runs the pinned commit as committed.`)

  const ts = join(root, 'ts')

  try {
    await access(join(ts, 'node_modules'))
  } catch {
    throw new Error(`${ts} has no node_modules. Run \`pnpm install --frozen-lockfile\` there.`)
  }

  return { ts, commit }
}
