import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

export type Source = {
  path: string
  code: string
  sha256: string
}

const runFile = promisify(execFile)
const maxFileBytes = 40_000
const textExtensions = new Set([
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
])

function forbiddenPath(path: string) {
  return path
    .split(sep)
    .some(
      part =>
        /^(?:\.git|\.env(?:\..*)?|\.ssh|\.aws|\.gnupg|\.npmrc|\.netrc)$/i.test(part) ||
        /^(?:credentials?|secrets?)(?:[._-]|$)/i.test(part) ||
        /^(?:id_rsa|id_ed25519|service[-_]?account)(?:[._-]|$)/i.test(part),
    )
}

export async function createEvidenceReader(root: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const checkout = await realpath(root)
  signal.throwIfAborted()
  const retained = new Map<string, { source: Source; dev: number; ino: number }>()

  function localPath(path: string) {
    signal.throwIfAborted()
    if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) {
      throw new Error('Evidence paths must be nonempty checkout-relative paths')
    }
    const name = relative(checkout, resolve(checkout, path))
    if (
      name === '..' ||
      name.startsWith(`..${sep}`) ||
      isAbsolute(name) ||
      forbiddenPath(path) ||
      forbiddenPath(name)
    ) {
      throw new Error(`Evidence path is outside the allowed checkout context: ${path}`)
    }
    if (!textExtensions.has(extname(name).toLowerCase()))
      throw new Error(`Unsupported evidence text extension: ${name}`)
    return name
  }

  async function ignored(path: string) {
    signal.throwIfAborted()
    try {
      await runFile('git', ['check-ignore', '--no-index', '--quiet', '--', path], {
        cwd: checkout,
        signal,
        timeout: 5000,
        maxBuffer: 4096,
      })
      signal.throwIfAborted()
      return true
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof Error && 'code' in error && error.code === 1) return false
      throw new Error(`Cannot check Git ignore rules for ${path}`, { cause: error })
    }
  }

  async function allowedPath(name: string, absolute: string) {
    signal.throwIfAborted()
    const canonical = await realpath(absolute)
    signal.throwIfAborted()
    // Reject aliases as well as outside links: citations name the actual source.
    if (canonical !== absolute) throw new Error(`Evidence symlinks are not allowed: ${name}`)
    if (await ignored(name)) throw new Error(`Evidence path is Git-ignored: ${name}`)
  }

  async function read(path: string): Promise<Source> {
    const name = localPath(path)
    const absolute = resolve(checkout, name)
    await allowedPath(name, absolute)
    signal.throwIfAborted()
    // NONBLOCK prevents a swapped-in FIFO from hanging open; NOFOLLOW rejects a final symlink.
    const file = await open(
      absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    let snapshot: { source: Source; dev: number; ino: number }
    try {
      signal.throwIfAborted()
      const before = await file.stat()
      signal.throwIfAborted()
      if (!before.isFile()) throw new Error(`Evidence requires a regular text file: ${name}`)
      if (before.size > maxFileBytes) throw new Error(`Evidence file exceeds 40000 bytes: ${name}`)
      // Verify the opened object, not just its earlier pathname, across ancestor renames.
      if ((await realpath(`/proc/self/fd/${file.fd}`)) !== absolute)
        throw new Error(`Evidence path changed while opening: ${name}`)
      signal.throwIfAborted()
      const bytes = Buffer.alloc(before.size)
      let length = 0
      while (length < before.size) {
        signal.throwIfAborted()
        const result = await file.read(bytes, length, before.size - length, length)
        signal.throwIfAborted()
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      await allowedPath(name, absolute)
      const current = await lstat(absolute)
      const after = await file.stat()
      signal.throwIfAborted()
      if (
        length !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        current.isSymbolicLink() ||
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        (await realpath(`/proc/self/fd/${file.fd}`)) !== absolute
      ) {
        throw new Error(`Evidence source changed while reading: ${name}`)
      }
      signal.throwIfAborted()
      let code: string
      try {
        code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      } catch (error) {
        throw new Error(`Evidence is not UTF-8 text: ${name}`, { cause: error })
      }
      if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(code))
        throw new Error(`Evidence contains binary data: ${name}`)
      snapshot = {
        source: { path: name, code, sha256: createHash('sha256').update(bytes).digest('hex') },
        dev: before.dev,
        ino: before.ino,
      }
    } finally {
      await file.close()
    }
    signal.throwIfAborted()
    const previous = retained.get(name)
    if (
      previous &&
      (previous.source.sha256 !== snapshot.source.sha256 ||
        previous.dev !== snapshot.dev ||
        previous.ino !== snapshot.ino)
    ) {
      throw new Error(`Evidence source changed: ${name}`)
    }
    if (!previous) retained.set(name, snapshot)
    return { ...snapshot.source }
  }

  return {
    read,
    snapshots(): Source[] {
      return [...retained.values()].map(item => ({ ...item.source }))
    },
    async validate(): Promise<void> {
      signal.throwIfAborted()
      for (const path of retained.keys()) {
        try {
          await read(path)
        } catch (error) {
          signal.throwIfAborted()
          throw new Error(`Evidence source changed or became unavailable: ${path}`, {
            cause: error,
          })
        }
      }
    },
  }
}
