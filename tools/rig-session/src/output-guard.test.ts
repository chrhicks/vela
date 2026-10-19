import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { OutputInRepositoryError, refuseOutputInRepository } from './output-guard.ts'

test('a package is refused inside a git working tree unless git ignores the folder or --allow-in-repo is given', async () => {
  const repository = await mkdtemp(join(tmpdir(), 'rig-session-guard-'))
  const outside = await mkdtemp(join(tmpdir(), 'rig-session-outside-'))

  execFileSync('git', ['init', '-q', repository])

  const inside = join(repository, 'packages', 'night')

  await expect(refuseOutputInRepository(inside, false)).rejects.toThrow(OutputInRepositoryError)
  await expect(refuseOutputInRepository(inside, false)).rejects.toThrow(/refusing to write a package.*does not ignore it.*--allow-in-repo/)
  await expect(refuseOutputInRepository(repository, false)).rejects.toThrow(/refusing/)
  await refuseOutputInRepository(inside, true)
  await refuseOutputInRepository(join(outside, 'night'), false)

  await writeFile(join(repository, '.gitignore'), 'packages/\n')
  await refuseOutputInRepository(inside, false)
})
