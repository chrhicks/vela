import { chmod, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

export const isMissingFile = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

/** Atomic and private: the horizon files are site data. */
export async function writePrivateFile(path: string, text: string) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`

  await writeFile(temporary, text, { mode: 0o600 })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
}
