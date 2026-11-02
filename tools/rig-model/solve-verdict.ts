import { readFile, writeFile } from 'node:fs/promises'
import { judgeSolve, maxHintOffsetDegrees, purposes, scaleTolerance, fewestStars, type Expectation, type Purpose, type SolveFacts, type SolveVerdict } from '@vela/rig-astap'
import type { CorpusEntry } from './corpus-inventory.ts'

const usage = `usage: solve-verdict.ts [--corpus FILE] [--report FILE.md] [--audit-until INSTANT] [--parity 1|-1]
exit 0 the plan's check holds, 1 it does not, 2 bad arguments`

const given = new Map<string, string>()

for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]

  if (!name?.startsWith('--') || value === undefined) {
    console.error(usage)
    process.exit(2)
  }

  given.set(name.slice(2), value)
}

// SAFETY: corpus.json is written by corpus.ts with exactly this shape.
const corpus = JSON.parse(await readFile(given.get('corpus') ?? '/mnt/storage/rig/corpus/corpus.json', 'utf8')) as { fieldHeightDegrees: number; entries: CorpusEntry[] }

const auditUntil = Date.parse(given.get('audit-until') ?? '2026-11-01T02:00:00Z')

const parity = given.get('parity') === '-1' ? -1 : 1

const audited = corpus.entries.filter(entry => entry.source === 'alignment-trial' && entry.recorded !== null && Date.parse(entry.capturedAt ?? '') < auditUntil)

const height = audited[0]?.recorded?.wcs.height

if (height === undefined) {
  console.error('the corpus has no alignment solve to take the frame height from')
  process.exit(2)
}

const expected: Expectation = { arcsecPerPixel: (corpus.fieldHeightDegrees * 3600) / height, parity }

const nightOf = new Map(corpus.entries.flatMap(entry => (entry.night === null ? [] : [[entry.id, entry.night] as const])))

const falseSolveCase = 'PS-001'

interface Group {
  readonly title: string
  readonly entries: readonly { readonly id: string; readonly verdicts: Record<Purpose, SolveVerdict> }[]
}

type ReSolved = CorpusEntry & { readonly solve: Extract<NonNullable<CorpusEntry['solve']>, { readonly status: 'solved' }> }

const isReSolved = (entry: CorpusEntry): entry is ReSolved => entry.solve?.status === 'solved'

function groupOf<Entry extends CorpusEntry>(title: string, entries: readonly Entry[], facts: (entry: Entry) => SolveFacts): Group {
  return {
    title,
    entries: entries.map(entry => {
      const input = facts(entry)

      return { id: entry.id, verdicts: { framing: judgeSolve(input, expected, 'framing'), alignment: judgeSolve(input, expected, 'alignment') } }
    }),
  }
}

const recorded = groupOf('Alignment solves Vela recorded (the audit set)', audited, entry => ({ solution: { status: 'solved', wcs: entry.recorded!.wcs }, stars: null, claimed: entry.recorded!.hint }))

const resolved = groupOf(
  'The same trials re-solved by the real ASTAP, with its star count (frames that kept their pixels)',
  corpus.entries.filter(isReSolved).filter(entry => entry.source === 'alignment-trial' && entry.stars !== null),
  entry => ({ solution: { status: 'solved', wcs: entry.solve.wcs }, stars: entry.stars, claimed: entry.solve.hint }),
)

const lights = groupOf(
  "Step 4's saved lights that solved (not part of the check; the hint is the one its solve used)",
  corpus.entries.filter(isReSolved).filter(entry => entry.source === 'saved-image'),
  entry => ({ solution: { status: 'solved', wcs: entry.solve.wcs }, stars: null, claimed: entry.solve.hint }),
)

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`

function tally(group: Group, purpose: Purpose): string {
  const accepted = group.entries.filter(entry => entry.verdicts[purpose].status === 'accepted').length
  const byReason = new Map<string, number>()

  for (const { verdicts } of group.entries) {
    const verdict = verdicts[purpose]

    if (verdict.status === 'rejected') for (const reason of verdict.reasons) byReason.set(reason, (byReason.get(reason) ?? 0) + 1)
  }

  const rejected = [...byReason].map(([reason, count]) => `${reason} ${count}`).join(', ')

  return `| ${purpose} | ${group.entries.length} | ${accepted} | ${group.entries.length - accepted} | ${rejected || 'none'} |`
}

function table(group: Group): string[] {
  return [`## ${group.title}`, '', '| Purpose | Solves | Accepted | Rejected | Rejected by reason (a frame can have several) |', '| --- | --- | --- | --- | --- |', ...purposes.map(purpose => tally(group, purpose)), '']
}

function rejectedByNight(group: Group): string[] {
  const nights = new Map<string, number>()

  for (const entry of group.entries) {
    const night = nightOf.get(entry.id) ?? 'unknown'

    if (entry.verdicts.framing.status === 'rejected') nights.set(night, (nights.get(night) ?? 0) + 1)
  }

  return [`Saved lights rejected for framing, by night: ${[...nights].map(([night, count]) => `${night} ${count}`).join(', ') || 'none'}.`, '']
}

const falseIds = new Set(corpus.entries.filter(entry => entry.cases.includes(falseSolveCase)).map(entry => entry.id))

const good = recorded.entries.filter(entry => !falseIds.has(entry.id))

const falseSolves = recorded.entries.filter(entry => falseIds.has(entry.id))

const goodMeasured = good.flatMap(entry => (entry.verdicts.alignment.measured ? [entry.verdicts.alignment.measured] : []))

const worstScale = Math.max(...goodMeasured.map(measured => Math.abs(measured.scaleError)))

const worstOffset = Math.max(...goodMeasured.map(measured => measured.hintOffsetDegrees ?? 0))

const fewest = Math.min(...resolved.entries.flatMap(entry => entry.verdicts.alignment.measured?.stars ?? []))

const lines = [
  '# Solve verdict check (build plan step 6)',
  '',
  `Expected scale ${expected.arcsecPerPixel.toFixed(4)} arcsec/px, from the configured field height of the trials, parity ${expected.parity > 0 ? '+1' : '-1'}. Limits: scale ${percent(scaleTolerance.framing)} for framing and ${percent(scaleTolerance.alignment)} for alignment, hint offset ${maxHintOffsetDegrees} degrees, fewest stars ${fewestStars}.`,
  '',
  ...table(recorded),
  ...table(resolved),
  ...table(lights),
  ...rejectedByNight(lights),
  '## The check',
  '',
  `- Good frames: ${good.length} in the audit set. Rejected for alignment: ${good.filter(entry => entry.verdicts.alignment.status === 'rejected').length}. Rejected for framing: ${good.filter(entry => entry.verdicts.framing.status === 'rejected').length}.`,
  `- Largest scale error of a good frame: ${percent(worstScale)} (limit ${percent(scaleTolerance.alignment)} for alignment). Largest offset from the mount's claim: ${worstOffset.toFixed(2)} degrees (limit ${maxHintOffsetDegrees}). Fewest stars among the re-solved frames: ${fewest} (limit ${fewestStars}).`,
  ...falseSolves.flatMap(entry =>
    purposes.map(purpose => {
      const verdict = entry.verdicts[purpose]
      const measured = verdict.measured

      return `- False solve \`${entry.id}\` for ${purpose}: ${verdict.status}${verdict.status === 'rejected' ? ` (${verdict.reasons.join(', ')})` : ''}${measured ? `; scale ${measured.arcsecPerPixel.toFixed(4)} arcsec/px (${percent(measured.scaleError)}), parity ${measured.parity > 0 ? '+1' : '-1'}, ${measured.hintOffsetDegrees?.toFixed(1)} degrees from the claim` : ''}.`
    }),
  ),
  '',
]

const falseHeld = falseSolves.length > 0 && falseSolves.every(entry => purposes.every(purpose => entry.verdicts[purpose].status === 'rejected'))

const goodHeld = good.length > 0 && good.every(entry => entry.verdicts.alignment.status === 'accepted')

lines.push(falseHeld && goodHeld ? 'Result: the false solve is rejected and every good frame is accepted for alignment.' : 'Result: the check does not hold.', '')

if (given.has('report')) await writeFile(given.get('report')!, lines.join('\n'))
else console.log(lines.join('\n'))

process.exit(falseHeld && goodHeld ? 0 : 1)
