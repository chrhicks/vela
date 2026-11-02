import { caseResults, measuredOf, median, type CorpusEntry } from './corpus-inventory.ts'

const tally = (values: readonly string[]) => {
  const counts = new Map<string, number>()

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

  return [...counts].toSorted(([a], [b]) => a.localeCompare(b))
}

const row = (cells: readonly (string | number)[]) => `| ${cells.join(' | ')} |`

const table = (head: readonly string[], rows: readonly (readonly (string | number)[])[]) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n')

function scaleCells(label: string, entries: readonly CorpusEntry[]): (string | number)[] {
  const scales = entries.flatMap(entry => measuredOf(entry)?.scale ?? [])
  const mirrored = entries.filter(entry => measuredOf(entry)?.parity === -1)

  return [label, scales.length, scales.length === 0 ? 'none' : median(scales).toFixed(4), mirrored.length === 0 ? 'none' : mirrored.map(entry => entry.id).join(', ')]
}

/**
 * The corpus in words, for the person who reads it. It names frames by entry id and night only: no coordinates, no
 * site, no sidereal time.
 */
export function reportOf(entries: readonly CorpusEntry[], options: { readonly solverVersion: string; readonly auditUntil: string }): string {
  const alignment = entries.filter(entry => entry.source === 'alignment-trial')
  const audited = alignment.filter(entry => entry.capturedAt !== null && entry.capturedAt <= options.auditUntil)
  const reSolved = alignment.flatMap(entry => (entry.solve?.status === 'solved' ? [{ ...entry, recorded: null }] : []))
  const saved = entries.filter(entry => entry.source === 'saved-image')

  const sources = tally(entries.map(entry => entry.source)).map(([source, count]) => {
    const own = entries.filter(entry => entry.source === source)
    const missing = tally(own.flatMap(entry => (entry.pixels.kind === 'missing' ? [entry.pixels.reason] : []))).map(([reason, total]) => `${total} ${reason}`)

    return [source, count, own.filter(entry => entry.pixels.kind === 'file').length, missing.join(', ') || 'none']
  })

  const solves = tally(saved.map(entry => (entry.solve === null ? 'no solve in step 4\'s cache' : entry.solve.status === 'solved' ? 'solved' : entry.solve.reason)))

  const results = caseResults(entries)

  return [
    '# Solve corpus (build plan step 5)',
    '',
    `Every entry is a frame the solve verdict (step 6) will be tested against, with its pixels (path and sha256) or the reason they are missing. Solves are by the real ${options.solverVersion}.`,
    '',
    '## Entries by source',
    '',
    table(['Source', 'Entries', 'With pixels', 'Pixels missing'], sources),
    '',
    `Step 4's saved lights by solve: ${solves.map(([name, count]) => `${count} ${name}`).join(', ')}.`,
    '',
    '## Audit cases',
    '',
    table(
      ['Case', 'What it is', 'Entries', 'With pixels', 'Status'],
      results.map(result => [result.id, result.title, result.entries, result.withPixels, `**${result.status}**`]),
    ),
    '',
    '## Frames the corpus could not keep',
    '',
    ...entries.flatMap(entry => (entry.note === null ? [] : [`- \`${entry.id}\` (${entry.cases.join(', ')}): ${entry.note}`])),
    '',
    '## Plate scale and mirrored frames',
    '',
    'Scale is the square root of the CD determinant, in arcseconds per pixel. A negative determinant is a mirrored frame.',
    '',
    table(
      ['Frames', 'Solves', 'Median scale ("/px)', 'Mirrored'],
      [
        scaleCells(`alignment solves Vela recorded, the audit's set (captured by ${options.auditUntil})`, audited),
        scaleCells('alignment solves Vela recorded, all', alignment),
        scaleCells('the same frames re-solved by the real ASTAP now (those with pixels)', reSolved),
        scaleCells("step 4's saved lights, solved by the real ASTAP", saved),
      ],
    ),
    '',
  ].join('\n')
}
