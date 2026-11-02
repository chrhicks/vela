import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

export async function sha256File(path: string) {
  const hash = createHash('sha256')

  await pipeline(createReadStream(path), hash)

  return hash.digest('hex')
}

/**
 * One digest for every file under `root`: each file's path and SHA-256, sorted by path. Files are read one at a
 * time with async streams, so the event loop keeps serving requests while a large catalog is hashed.
 */
export async function sha256Directory(root: string) {
  const paths = (await readdir(root, { recursive: true })).sort()
  const digest = createHash('sha256')

  for (const path of paths) {
    if (!(await stat(join(root, path))).isFile()) continue

    digest.update(`${path}\0${await sha256File(join(root, path))}\n`)
  }

  return digest.digest('hex')
}
