import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scrubFile, type Finding, type Rule } from './scrub.ts'

const fixtureExtensions = /\.(fits?|fts|blob|csv|jsonl|xml)$/i

const fixturePath = /(^|\/)(fixtures?|golden|testdata|recordings?|tapes?)(\/|$)|\.fixture\.|\.golden\./i

const skipped = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|parquet)$|(^|\/)pnpm-lock\.yaml$/i

/** Which of the tracked files are committed fixtures: data a test reads, as opposed to source. */
export function committedFixtures(tracked: ReadonlyArray<string>): string[] {
  return tracked.filter(path => !skipped.test(path) && (fixtureExtensions.test(path) || fixturePath.test(path)))
}

/**
 * Findings that were committed before the guard existed. Removing one from the repository does not
 * unpublish it, so each stays listed, with the reason, until Chris decides what to do about it. An
 * exception that no longer matches a finding is an error, so this list cannot outlive its cause.
 */
export const knownExceptions: ReadonlyArray<{ path: string; rule: Rule; reason: string }> = []

export interface ScrubReport {
  scanned: string[]
  findings: Finding[]
  /** Exceptions that no longer match anything. */
  staleExceptions: string[]
}

/** Scrubs the committed fixtures of the Git repository at `root`. */
export function scrubRepository(root: string): ScrubReport {
  const tracked = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean)
  const scanned = committedFixtures(tracked)
  const all = scanned.flatMap(path => scrubFile(path, readFileSync(join(root, path))))
  const excused = (finding: Finding) => knownExceptions.some(known => known.path === finding.path && known.rule === finding.rule)

  return {
    scanned,
    findings: all.filter(finding => !excused(finding)),
    staleExceptions: knownExceptions.flatMap(known =>
      scanned.includes(known.path) && !all.some(finding => finding.path === known.path && finding.rule === known.rule)
        ? [`${known.path} (${known.rule})`]
        : [],
    ),
  }
}
