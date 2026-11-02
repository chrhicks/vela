import { mkdtemp as createTempDir, rm } from 'node:fs/promises'
import { afterAll } from 'vitest'

const directories = []

afterAll(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

export async function mkdtemp(prefix) {
  const directory = await createTempDir(prefix)
  directories.push(directory)

  return directory
}
