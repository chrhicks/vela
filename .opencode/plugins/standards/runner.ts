import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { parseEnv, promisify } from 'node:util'
import { applicabilityQuestions, judgmentQuestions, referenceStandards, standards } from './checks.ts'
import { askJev, type Answer, type Call, type State } from './jev.ts'

const exec = promisify(execFile)
export type CheckInput = {
  paths?: readonly string[]
  mode?: 'files' | 'changes'
  base?: string
  supportingPaths?: readonly string[]
  applicabilityThreshold?: number
}
type FileResult = {
  path: string
  failed: string[]
  inconclusive: string[]
  skipped?: string
  error?: string
  sha256?: string
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return error.cause ? `${error.message}: ${errorText(error.cause)}` : error.message
}

export async function checkStandards(directory: string, input: CheckInput, signal: AbortSignal, send = globalThis.fetch) {
  const git = async (...args: string[]) => (await exec('git', args, { cwd: directory, signal, maxBuffer: 4 * 1024 * 1024 })).stdout
  const root = await realpath((await git('rev-parse', '--show-toplevel')).trim())
  directory = root
  const threshold = input.applicabilityThreshold ?? 0.7
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('Applicability threshold must be between 0 and 1')
  const mode = input.mode ?? 'changes'
  if (mode === 'files' && !input.paths?.length) throw new Error('File mode requires paths')
  const base = (await git('rev-parse', '--verify', '--end-of-options', `${input.base ?? 'HEAD'}^{commit}`)).trim()
  const key = process.env.TYPESAFE_API_KEY || parseEnv(await readFile(join(root, '.env'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })).TYPESAFE_API_KEY
  if (!key) throw new Error('Set TYPESAFE_API_KEY in the server environment or the project .env')
  const document = await readFile(join(root, 'CODING_STANDARDS.md'), 'utf8')
  const coding_standards = referenceStandards(document)
  const paths = input.paths?.length ? [...input.paths] : [
    ...(await git('diff', '--name-only', '-z', base, '--')).split('\0'),
    ...(await git('ls-files', '--others', '--exclude-standard', '-z')).split('\0'),
  ].filter(Boolean)

  async function readSource(path: string, kind: 'target' | 'context' = 'target') {
    const absolute = await realpath(resolve(root, path))
    const local = relative(root, absolute)
    if (local.startsWith('../') || isAbsolute(local)) throw new Error('Source must be inside this checkout')
    const extension = kind === 'context' ? /\.(?:[cm]?[jt]sx?|md|txt|json|ya?ml)$/ : /\.(?:[cm]?[jt]sx?)$/
    if (!extension.test(local)) throw new Error('Targets must be JS/TS; supporting context may also be Markdown, text, JSON or YAML')
    const ignored = await exec('git', ['check-ignore', '--', local], { cwd: root, signal }).then(() => true, error => {
      if (error.code === 1) return false
      throw error
    })
    if (ignored) throw new Error('Ignored files are excluded from standards checks')
    const code = await readFile(absolute, 'utf8')
    if (code.includes('\0') || Buffer.byteLength(code) > 40_000) throw new Error('Source is binary or exceeds the prototype 40 KB file limit')
    return { path: local, code }
  }

  const supporting_context: Record<string, string> = {}
  for (const path of input.supportingPaths ?? []) {
    const source = await readSource(path, 'context')
    supporting_context[source.path] = source.code
  }

  const artifact = join(root, '.opencode/.local/standards', `${randomUUID()}.json`)
  await mkdir(join(root, '.opencode/.local/standards'), { recursive: true })
  const calls: Call[] = []
  const results: FileResult[] = []

  try {
    for (const path of new Set(paths)) {
      signal.throwIfAborted()
      const result: FileResult = { path, failed: [], inconclusive: [] }
      results.push(result)
      if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) {
        result.skipped = 'Not JavaScript/TypeScript source'
        continue
      }

      try {
        const source = await readSource(path)
        result.path = source.path
        result.sha256 = createHash('sha256').update(source.code).digest('hex')
        const state: State = { ...source, supporting_context, coding_standards }
        if (mode === 'changes') {
          const diff = await git('diff', '--no-ext-diff', '--no-textconv', '--unified=8', base, '--', source.path)
          const trackedAtBase = await git('ls-tree', '--name-only', base, '--', source.path)
          if (!diff && trackedAtBase) {
            result.skipped = 'No changes against the selected base'
            continue
          }
          if (diff) state.diff = diff
        }
        if (Buffer.byteLength(JSON.stringify(state)) > 60_000) {
          result.skipped = 'Code and context exceed the prototype 60 KB state limit'
          continue
        }
        const applicability = await askJev(state, applicabilityQuestions(), key, signal, calls, send)
        const selected = standards.filter(standard => {
          const answer = applicability[standard.id]
          return answer.type === 'noul' && answer.noul > threshold
        }).map(standard => standard.id)
        if (selected.length) {
          const focused = { ...state, coding_standards: Object.fromEntries(selected.map(id => [id, coding_standards[id]])) }
          const judgments = await askJev(focused, judgmentQuestions(selected), key, signal, calls, send)
          collectFindings(judgments, result)
        }
        if ((await readSource(path)).code !== source.code) throw new Error('File changed during review; rerun against its current contents')
        for (const [supportPath, code] of Object.entries(supporting_context)) {
          if ((await readSource(supportPath, 'context')).code !== code) throw new Error(`Supporting source ${supportPath} changed during review; rerun with current context`)
        }
        if (await readFile(join(root, 'CODING_STANDARDS.md'), 'utf8') !== document) throw new Error('Coding standards changed during review; rerun against current standards')
      } catch (error) {
        signal.throwIfAborted()
        result.failed = []
        result.inconclusive = []
        result.error = errorText(error)
      }
    }
  } finally {
    await writeFile(artifact, JSON.stringify({ time: new Date().toISOString(), base, mode, threshold, document, results, calls }, null, 2), { mode: 0o600 })
  }

  const lines = results.filter(result => result.failed.length).map(result => `${result.path}: ${result.failed.join(', ')}`)
  const uncertain = results.filter(result => result.inconclusive.length || result.error)
  for (const result of uncertain) lines.push(`${result.path}: inconclusive — ${result.error ?? result.inconclusive.join(', ')}`)
  const skipped = results.filter(result => result.skipped)
  for (const result of skipped) lines.push(`${result.path}: skipped — ${result.skipped}`)
  if (!lines.length) lines.push('No failed standards reported by the selected checks.')
  lines.push(`${results.length - skipped.length - results.filter(result => result.error).length} files evaluated · ${results.filter(result => result.failed.length).length} flagged · ${uncertain.length} inconclusive · ${skipped.length} skipped`)
  lines.push(`Raw judgments and source snapshots: ${artifact}`)
  return lines.join('\n')
}

function collectFindings(judgments: Readonly<Record<string, Answer>>, result: FileResult) {
  for (const standard of standards) {
    const answers = Object.entries(judgments).filter(([id]) => id.startsWith(`${standard.id}.`)).map(([, answer]) => answer)
    if (answers.some(answer => answer.type === 'choice' && answer.choice === 'violated')) result.failed.push(standard.id)
    else if (answers.some(answer => answer.type === 'choice' && answer.choice === 'insufficient_context')) result.inconclusive.push(standard.id)
  }
}
