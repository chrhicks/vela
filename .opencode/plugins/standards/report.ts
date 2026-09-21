import { readFile } from 'node:fs/promises'
import { Schema } from 'effect'
import { createEvidenceReader } from './evidence.ts'
import { reportSchema, type Report } from './rpc.ts'

const artifactSchema = Schema.Struct({
  schemaVersion: Schema.Literal(3), root: Schema.String, report: reportSchema,
  sources: Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
})

export async function readReport(artifact: string): Promise<Report> {
  const json = JSON.parse(await readFile(artifact, 'utf8'))
  if (json.schemaVersion !== 3) return {
    schemaVersion: 3, artifact, time: typeof json.time === 'string' ? json.time : new Date().toISOString(), mode: 'files',
    model: 'legacy', status: 'incomplete', diagnostics: [], missingEvidence: [], files: [],
    error: 'Legacy detector report. Its original JSON is retained at the artifact path; run /standards for direct-review diagnostics.',
  }
  const saved = Schema.decodeUnknownSync(artifactSchema)(json)
  try {
    const reader = await createEvidenceReader(saved.root, AbortSignal.timeout(10_000))
    for (const source of saved.sources) {
      if ((await reader.read(source.path)).sha256 !== source.sha256) throw new Error(`${source.path} changed since this review`)
    }
  } catch (error) {
    return { ...saved.report, artifact, status: 'stale', error: error instanceof Error ? error.message : 'Reviewed evidence is unavailable' }
  }
  return { ...saved.report, artifact }
}

export function formatReport(report: Report) {
  const lines = [`Standards review · ${report.status} · ${report.model}`]
  if (report.status === 'stale') lines.push('Saved diagnostics are unaccepted because the evidence changed.')
  else for (const diagnostic of report.diagnostics) {
    const { location } = diagnostic
    lines.push(`${location.path}:${location.startLine}-${location.endLine} · ${diagnostic.severity} · ${diagnostic.rule}`,
      diagnostic.message, `  ${diagnostic.explanation}`, `  Evidence: ${location.quote}`,
      ...diagnostic.related.map(source => `  Related: ${source.path}:${source.startLine}-${source.endLine} — ${source.quote}`),
      `  Suggested correction: ${diagnostic.suggestion}`)
  }
  if (report.error) lines.push(`Check status: ${report.error}`)
  for (const missing of report.missingEvidence) lines.push(`Missing evidence for ${missing.path}: ${missing.reason}\n  Next: ${missing.nextAction}`)
  for (const file of report.files) {
    if (file.error) lines.push(`${file.path}: incomplete — ${file.error}`)
    if (file.skipped) lines.push(`${file.path}: skipped — ${file.skipped}`)
  }
  const count = report.status === 'stale' ? 0 : report.diagnostics.length
  const evaluated = report.files.filter(file => !file.error && !file.skipped).length
  lines.push(`${count} diagnostics · ${evaluated} targets supplied · ${report.missingEvidence.length} unresolved code questions`)
  if (!count) lines.push(report.status === 'complete' ? 'No diagnostics reported; this is not a correctness or merge verdict.' : 'Incomplete or stale review is not a clean check.')
  lines.push(`Saved source snapshot: ${report.time}\nReview evidence: ${report.artifact}`)
  return lines.join('\n')
}
