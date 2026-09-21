import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createEvidenceReader } from './evidence.ts'
import { reviewStandards, type GenerateReview, type Review, type Target } from './reviewer.ts'
import { formatReport } from './report.ts'
import type { Report } from './rpc.ts'

const exec = promisify(execFile)
export type CheckInput = { paths?: readonly string[], mode?: 'files' | 'changes', base?: string, supportingPaths?: readonly string[] }

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  return error.cause ? `${error.message}: ${errorText(error.cause)}` : error.message
}

export async function checkStandards(directory: string, input: CheckInput, signal: AbortSignal,
  reviewer: { model: string, generate: GenerateReview }) {
  const git = async (...args: string[]) => (await exec('git', args, { cwd: directory, signal, maxBuffer: 4 * 1024 * 1024 })).stdout
  const root = await realpath((await git('rev-parse', '--show-toplevel')).trim())
  directory = root
  const mode = input.mode ?? 'changes'
  if (mode === 'files' && !input.paths?.length) throw new Error('File mode requires paths')
  const base = (await git('rev-parse', '--verify', '--end-of-options', `${input.base ?? 'HEAD'}^{commit}`)).trim()
  const paths = [...new Set(input.paths?.length ? input.paths : [
    ...(await git('diff', '--name-only', '-z', base, '--')).split('\0'),
    ...(await git('ls-files', '--others', '--exclude-standard', '-z')).split('\0'),
  ].filter(Boolean))]
  if (paths.length > 30 || (input.supportingPaths?.length ?? 0) > 30) throw new Error('Select at most 30 targets and 30 supporting paths per review')
  const artifact = join(root, '.opencode/.local/standards', `${randomUUID()}.json`)
  await mkdir(join(root, '.opencode/.local/standards'), { recursive: true })
  const reader = await createEvidenceReader(root, signal)
  const files: { path: string, error?: string, skipped?: string }[] = []
  let report: Report = { schemaVersion: 3, artifact, time: new Date().toISOString(), mode, model: reviewer.model,
    status: 'complete', diagnostics: [], missingEvidence: [], files }
  let review: Review | undefined
  try {
    const standards = await reader.read('CODING_STANDARDS.md')
    const guidance = await reader.read('AGENTS.md').catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    const context = []
    for (const path of new Set(input.supportingPaths ?? [])) context.push(await reader.read(path))
    const targets: Target[] = []
    for (const path of paths) {
      signal.throwIfAborted()
      const file: typeof files[number] = { path }
      files.push(file)
      if (!/\.(?:[cm]?[jt]sx?)$/.test(path)) { file.skipped = 'Not JavaScript/TypeScript source'; continue }
      try {
        const source = await reader.read(path)
        file.path = source.path
        if (targets.some(target => target.path === source.path)) { file.skipped = 'Duplicate target'; continue }
        const target: Target = { ...source }
        if (mode === 'changes') {
          const diff = await git('diff', '--no-ext-diff', '--no-textconv', '--unified=8', base, '--', source.path)
          if (!diff && await git('ls-tree', '--name-only', base, '--', source.path)) {
            file.skipped = 'No changes against the selected base'
            continue
          }
          if (diff) target.diff = diff
        }
        targets.push(target)
      } catch (error) {
        signal.throwIfAborted()
        file.error = errorText(error)
      }
    }
    if (targets.length) {
      review = await reviewStandards({ targets, context, standards, guidance }, reviewer.generate, signal)
      report = { ...report, diagnostics: review.diagnostics, missingEvidence: review.missingEvidence, error: review.error }
    }
    if (report.error || report.missingEvidence.length || files.some(file => file.error)) report = { ...report, status: 'incomplete' }
    try { await reader.validate() } catch (error) {
      signal.throwIfAborted()
      report = { ...report, status: 'stale', error: errorText(error) }
    }
  } catch (error) {
    report = { ...report, status: 'incomplete', error: errorText(error) }
    signal.throwIfAborted()
  } finally {
    await writeFile(artifact, JSON.stringify({ schemaVersion: 3, root, base, report, sources: reader.snapshots(), review }, null, 2), { mode: 0o600 })
  }
  return { content: formatReport(report), artifact }
}
