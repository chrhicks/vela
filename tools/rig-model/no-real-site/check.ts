import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { isBinary, formatHit, parseForbidden, scanText, type Hit } from './scan.ts'

const repo = resolve(import.meta.dirname, '../../..')

const maxBytes = 8 * 1024 * 1024

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name)

  return at === -1 ? undefined : process.argv[at + 1]
}

function listFiles(root: string): string[] {
  if (root === repo)
    return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo, encoding: 'utf8' })
      .split('\0')
      .filter(path => path !== '' && existsSync(join(repo, path)))

  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
}

function scanFiles(root: string, forbidden: readonly string[]) {
  const hits: Hit[] = []
  const skipped: string[] = []

  for (const path of listFiles(root)) {
    const full = join(root, path)

    if (statSync(full).size > maxBytes) {
      skipped.push(path)
      continue
    }

    const bytes = readFileSync(full)

    if (isBinary(bytes)) {
      skipped.push(path)
      continue
    }

    hits.push(...scanText(path, bytes.toString('utf8'), forbidden))
  }

  return { hits, skipped }
}

function scanHistory(forbidden: readonly string[]): Hit[] {
  const log = execFileSync('git', ['log', '--all', '-p', '--no-color', '--format=commit %H'], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  })

  const hits: Hit[] = []
  let commit = ''
  let line = 0

  for (const text of log.split('\n')) {
    if (text.startsWith('commit ')) {
      commit = text.slice(7, 19)
      line = 0
    }

    line++

    hits.push(...scanText(`history ${commit}`, text, forbidden).map(hit => ({ ...hit, line })))
  }

  return hits
}

const named = option('--forbidden') || process.env['RIG_FORBIDDEN_VALUES'] || undefined

const listPath = named ?? join(homedir(), '.config/rig/forbidden-values.txt')

const inCi = !['', '0', 'false'].includes(process.env['CI'] ?? '')

// The list holds the real site and lives only on Chris's machines, so a CI runner never has it.
// Skipping is allowed only when nobody named a list and CI is set; a named list that is missing still fails.
if (!existsSync(listPath) && named === undefined && inCi) {
  console.log('no-real-site: skipped in CI, the forbidden-values list is not on this machine. Run it locally.')
  process.exit(0)
}

if (!existsSync(listPath)) {
  console.error(`no-real-site: the forbidden-values list is missing (${listPath}). Without it this check proves nothing, so it fails.`)
  process.exit(2)
}

const forbidden = parseForbidden(readFileSync(listPath, 'utf8'))

if (forbidden.length === 0) {
  console.error('no-real-site: the forbidden-values list is empty. Without values this check proves nothing, so it fails.')
  process.exit(2)
}

const root = option('--root') === undefined ? repo : resolve(option('--root') ?? repo)

const history = process.argv.includes('--history')

const scanned = history ? { hits: scanHistory(forbidden), skipped: [] } : scanFiles(root, forbidden)

const { hits, skipped } = scanned

for (const hit of hits) console.error(formatHit(hit))

for (const path of skipped) console.error(`${path}: not scanned (binary or over ${maxBytes / 1024 / 1024} MiB)`)

console.log(
  hits.length === 0
    ? `no-real-site: clean (${forbidden.length} forbidden values, ${history ? 'git history' : `working tree, ${skipped.length} binary or oversized files not scanned`})`
    : `no-real-site: ${hits.length} hit(s)`,
)

process.exit(hits.length === 0 ? 0 : 1)
