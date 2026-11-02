import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestProject } from 'vitest/node'

export default async function setup(project: TestProject) {
  const directory = await mkdtemp(join(tmpdir(), 'vela-tests-'))
  const tsxCache = join(directory, `tsx-${process.geteuid?.() ?? process.env.USER}`)
  await mkdir(tsxCache)
  project.config.env.TMPDIR = directory
  project.config.env.TMP = directory
  project.config.env.TEMP = directory

  return async () => {
    try {
      await rm(tsxCache, { recursive: true, force: true })
      const leftovers = await readdir(directory)

      if (leftovers.length > 0) {
        process.exitCode = 1
        throw new Error(`Tests leaked temporary entries: ${leftovers.sort().join(', ')}`)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
