import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gatewayProblems } from './wire-gateway.ts'

const repo = resolve(import.meta.dirname, '../../..')

const fixtures = join(import.meta.dirname, 'fixtures')

const oxlint = join(repo, 'node_modules/.bin/oxlint')

const checker = join(repo, 'tools/rig-model/no-real-site/check.ts')

interface Diagnostic {
  readonly code: string
}

function lint(directory: string) {
  const run = spawnSync(oxlint, ['--format', 'json', '--config', join(repo, '.oxlintrc.json'), directory], {
    cwd: repo,
    encoding: 'utf8',
  })

  const report: { diagnostics: Diagnostic[] } = JSON.parse(run.stdout)

  return { status: run.status ?? 2, diagnostics: report.diagnostics }
}

function folders(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

function gatewayOf(directory: string): string | undefined {
  const path = join(directory, 'packages/rig-events/src/wire.ts')

  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

const failures: string[] = []

const lines: string[] = []

function record(ok: boolean, name: string, detail: string) {
  lines.push(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`)

  if (!ok) failures.push(name)
}

for (const name of folders(join(fixtures, 'bad'))) {
  const directory = join(fixtures, 'bad', name)
  const expected = readFileSync(join(directory, 'EXPECT'), 'utf8').trim()

  if (expected === 'wire-gateway') {
    const gateway = gatewayOf(directory)
    const problems = gateway === undefined ? ['no gateway file in the fixture'] : gatewayProblems(gateway)
    record(problems.length > 0, name, problems.length > 0 ? `rejected (${problems[0]})` : 'accepted a bad gateway')
    continue
  }

  const { status, diagnostics } = lint(directory)
  const found = diagnostics.some(diagnostic => diagnostic.code === expected)
  const saw = diagnostics.map(diagnostic => diagnostic.code).join(', ')
  record(status !== 0 && found, name, found ? `rejected by ${expected}` : `expected ${expected}, saw [${saw}]`)
}

for (const name of folders(join(fixtures, 'good'))) {
  const directory = join(fixtures, 'good', name)
  const { status, diagnostics } = lint(directory)
  const gateway = gatewayOf(directory)
  const problems = gateway === undefined ? [] : gatewayProblems(gateway)
  const clean = status === 0 && problems.length === 0
  const saw = diagnostics.map(diagnostic => diagnostic.code).concat(problems).join(', ')
  record(clean, name, clean ? 'accepted' : `rejected [${saw}]`)
}

const realGateway = gatewayOf(repo)

const realProblems = realGateway === undefined ? ['packages/rig-events/src/wire.ts is missing'] : gatewayProblems(realGateway)

record(realProblems.length === 0, 'repository-gateway', realProblems.length === 0 ? 'packages/rig-events/src/wire.ts is a list of read-side re-exports' : realProblems.join('; '))

function checkSite(env: Record<string, string>, ...args: string[]) {
  return spawnSync('node', [checker, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } })
}

const siteFixtures = join(fixtures, 'no-real-site')

const forbiddenList = join(siteFixtures, 'forbidden.txt')

const planted = readFileSync(forbiddenList, 'utf8').split('\n')[0] ?? ''

const leak = checkSite({}, '--forbidden', forbiddenList, '--root', join(siteFixtures, 'bad'))

record(
  leak.status === 1 && leak.stderr.includes('leak.txt:2 holds forbidden value #1'),
  'no-real-site-bad',
  `exit ${leak.status}, reports file, line and entry`,
)

record(!leak.stdout.includes(planted) && !leak.stderr.includes(planted), 'no-real-site-silent', 'the report never prints the value')

const clean = checkSite({}, '--forbidden', forbiddenList, '--root', join(siteFixtures, 'good'))

record(clean.status === 0, 'no-real-site-good', `exit ${clean.status}`)

const missing = checkSite({ CI: '' }, '--forbidden', join(siteFixtures, 'absent.txt'))

record(missing.status === 2, 'no-real-site-needs-a-list', `exit ${missing.status} when the list is missing`)

const emptyHome = mkdtempSync(join(tmpdir(), 'no-real-site-'))

const noList = { HOME: emptyHome, RIG_FORBIDDEN_VALUES: '' }

const localWithoutList = checkSite({ ...noList, CI: '' })

record(localWithoutList.status === 2, 'no-real-site-local-needs-the-default-list', `exit ${localWithoutList.status} locally with no list`)

const ciWithoutList = checkSite({ ...noList, CI: '1' })

record(
  ciWithoutList.status === 0 && ciWithoutList.stdout.includes('skipped in CI'),
  'no-real-site-ci-skips',
  `exit ${ciWithoutList.status} in CI when the default list is absent`,
)

const ciNamedMissing = checkSite({ ...noList, CI: '1' }, '--forbidden', join(siteFixtures, 'absent.txt'))

record(ciNamedMissing.status === 2, 'no-real-site-ci-named-list-needed', `exit ${ciNamedMissing.status} in CI when a named list is missing`)

rmSync(emptyHome, { recursive: true })

console.log(lines.join('\n'))

if (failures.length > 0) {
  console.error(`guards: ${failures.length} failed`)
  process.exit(1)
}

console.log(`guards: ${lines.length} proofs held`)
