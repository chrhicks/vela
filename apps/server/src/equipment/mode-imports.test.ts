import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function lintAt(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), 'vela-mode-imports-'))
  directories.push(directory)
  cpSync(join(root, '.oxlintrc.json'), join(directory, '.oxlintrc.json'))
  symlinkSync(join(root, 'tools'), join(directory, 'tools'))
  symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'))

  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, path)), { recursive: true })
    writeFileSync(join(directory, path), source)
  }

  const result = spawnSync(join(root, 'node_modules/.bin/oxlint'), ['--threads', '1', '--format', 'json', ...Object.keys(files)], {
    cwd: directory,
    encoding: 'utf8',
  })

  if (result.error) throw result.error
  const report: { diagnostics: Array<{ filename: string; code: string }>; number_of_files: number } = JSON.parse(result.stdout)

  return {
    files: report.number_of_files,
    restricted: report.diagnostics
      .filter(diagnostic => diagnostic.code === 'eslint(no-restricted-imports)')
      .map(diagnostic => diagnostic.filename),
  }
}

it('rejects an adapter import outside composition and accepts Alpaca discovery', () => {
  const routes = 'apps/server/src/capture/routes.ts'
  const discovery = 'apps/server/src/rig/discovery.ts'

  const report = lintAt({
    [routes]: [
      "import { createAlpacaAcquisition } from '@vela/alpaca'",
      "import { CriaClient } from '@vela/cria'",
      readFileSync(join(root, routes), 'utf8'),
    ].join('\n'),
    [discovery]: readFileSync(join(root, discovery), 'utf8'),
  })

  expect(report).toEqual({ files: 2, restricted: [routes, routes] })
})
