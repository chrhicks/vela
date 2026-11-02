import type { EpochMs } from '@vela/rig-events'
import type { Trial } from '@vela/rig-frames'
import { alignmentBefore, marginArcmin, maxRunGapMs, minDriftFrames, minDriftSpanMs, pointingOf, type Drift, type Finding } from './backfill-analysis.ts'
import type { FrameRow } from './backfill-replay.ts'
import type { Window } from './backfill-sources.ts'

export interface NightResult {
  readonly night: string
  readonly window: Window
  readonly mountSource: 'recordings' | 'journal' | 'none'
  readonly rows: readonly FrameRow[]
  readonly trials: readonly Trial[]
  readonly drifts: readonly Drift[]
  readonly finding: Finding
}

export interface Report {
  readonly nights: readonly NightResult[]
  readonly solverVersion: string
  readonly utcOffsetMinutes: number
  /** Saved images in the nights covered, by frame type. Only lights are solved. */
  readonly images: ReadonlyMap<string, number>
  /** The night whose frames are listed one by one. */
  readonly listed: string | undefined
}

function quantile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? Number.NaN
}

const fixed = (value: number, digits = 1) => value.toFixed(digits)

const counted = (reasons: ReadonlyMap<string, number>) => (reasons.size === 0 ? 'none' : [...reasons].map(([reason, count]) => `${count} ${reason}`).join(', '))

export function tally(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)

  return counts
}

const zone = (minutes: number) => `UTC${minutes < 0 ? '-' : '+'}${Math.abs(minutes) / 60}`

export function summaryOf(night: NightResult) {
  const fixes = night.rows.flatMap(row => {
    const pointing = pointingOf(row)

    return pointing.kind === 'fix' ? [pointing.arcmin.total] : []
  })

  return {
    frames: night.rows.length,
    solveFailures: tally(night.rows.filter(row => row.solve !== 'solved').map(row => row.solve)),
    fixes: fixes.length,
    unjoined: tally(night.rows.flatMap(row => (row.solve === 'solved' && pointingOf(row).kind === 'none' ? [row.join.outcome === 'rejected' ? row.join.reason : 'undecided'] : []))),
    sorted: fixes.toSorted((a, b) => a - b),
  }
}

export function markdownOf(report: Report): string {
  const when = (at: EpochMs) => `${new Date(at + report.utcOffsetMinutes * 60_000).toISOString().slice(0, 19).replace('T', ' ')} ${zone(report.utcOffsetMinutes)}`
  const clock = (at: EpochMs) => new Date(at + report.utcOffsetMinutes * 60_000).toISOString().slice(11, 19)
  const lines: string[] = []

  lines.push(
    '# Rig backfill report (build plan step 4)',
    '',
    `Every saved light frame was solved with ${report.solverVersion} and joined to where the mount said it pointed at the exposure midpoint (\`capturedAt + exposureSeconds * 500\` ms), through the rig model's reducer. Times are local (${zone(report.utcOffsetMinutes)}). A night runs from local noon to local noon and is named for the date it starts. The nights hold ${[...report.images.values()].reduce((sum, count) => sum + count, 0)} saved images (${counted(report.images)}); only the lights are solved.`,
    '',
    'Three quantities, kept apart:',
    '',
    '- **Alignment evidence.** The polar error Vela\'s alignment measured, from its trial journals. It does not use the light frames. The reference for a run is the last reading of the newest trial before it, whatever its outcome.',
    '- **Pointing residual.** Where the sky was minus where the mount said it pointed, per frame, in arcminutes on the tangent plane at the mount\'s position (east along the parallel, north along the meridian). A goto error, a sync and a polar error all show up here.',
    `- **Drift.** The slope of the residual across one run of back-to-back exposures inside one motion epoch (nothing moved the mount), in arcseconds per minute. A pause of more than ${maxRunGapMs / 1000} s between exposures ends a run. Only runs with ${minDriftFrames} or more fixes over ${minDriftSpanMs / 60_000} minutes or more are fitted. A polar error E drifts the sky by at most E times Earth's rotation rate, so the drift's speed gives a least polar error (at two standard errors) to hold against the alignment evidence. A guided run drifts little whatever the polar error is, so a small drift proves nothing. A tracking-rate error also drifts east, which is part of why the margin is wide.`,
    '',
    '## Nights',
    '',
    '| Night | Mount history | Light frames | Solved | Solve failed | Joined | Not joined | Residual median / p90 (arcmin) | Finding |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  )

  const verdict = (finding: Finding) => {
    switch (finding.kind) {
      case 'no-alignment':
        return 'not tested (no alignment reading)'
      case 'steady':
        return `steady (${finding.tested} runs)`
      case 'shift':
        return `${finding.shift.corroboration ? 'shift' : 'drift beyond alignment, not corroborated'}, ${finding.complete ? 'bracketed' : '**incomplete**'}`
    }
  }

  const totals = { frames: 0, solved: 0, failed: new Map<string, number>(), fixes: 0, unjoined: new Map<string, number>() }

  for (const night of report.nights) {
    const summary = summaryOf(night)
    const solved = summary.frames - [...summary.solveFailures.values()].reduce((sum, count) => sum + count, 0)

    totals.frames += summary.frames
    totals.solved += solved
    totals.fixes += summary.fixes

    for (const [reason, count] of summary.solveFailures) totals.failed.set(reason, (totals.failed.get(reason) ?? 0) + count)

    for (const [reason, count] of summary.unjoined) totals.unjoined.set(reason, (totals.unjoined.get(reason) ?? 0) + count)

    lines.push(
      `| ${night.night} | ${night.mountSource} | ${summary.frames} | ${solved} | ${counted(summary.solveFailures)} | ${summary.fixes} | ${counted(summary.unjoined)} | ${summary.fixes === 0 ? 'none' : `${fixed(quantile(summary.sorted, 0.5), 2)} / ${fixed(quantile(summary.sorted, 0.9), 2)}`} | ${verdict(night.finding)} |`,
    )
  }

  lines.push(
    `| **All** | | ${totals.frames} | ${totals.solved} | ${counted(totals.failed)} | ${totals.fixes} | ${counted(totals.unjoined)} | | |`,
    '',
  )

  for (const night of report.nights) {
    const { finding } = night
    const readings = night.trials.filter(trial => trial.readings.length > 0)

    lines.push(`## Night ${night.night}`, '', night.mountSource === 'none' ? 'No recording or journal holds the mount for this night, so no frame can be joined to it.' : `Mount history from ${night.mountSource === 'recordings' ? "errai's INDI recordings" : "Vela's Cria journal"}.`, '')

    lines.push('### Alignment evidence', '')

    if (readings.length === 0) lines.push('No alignment trial this night.', '')
    else {
      lines.push('| Run | Outcome | First reading (arcmin) | Last reading (arcmin) | Last reading at |', '| --- | --- | --- | --- | --- |')

      for (const trial of readings) {
        const first = trial.readings[0]
        const last = trial.readings[trial.readings.length - 1]

        lines.push(`| ${trial.runId.slice(0, 8)} | ${trial.outcome} | ${fixed((first?.totalArcsec ?? 0) / 60)} | ${fixed((last?.totalArcsec ?? 0) / 60)} | ${last ? clock(last.at) : ''} |`)
      }

      lines.push('')
    }

    lines.push('### Pointing residual', '')

    const summary = summaryOf(night)

    if (summary.fixes === 0) lines.push('No frame joined to the mount.', '')
    else lines.push(`${summary.fixes} fixes. Total residual median ${fixed(quantile(summary.sorted, 0.5), 2)}, p90 ${fixed(quantile(summary.sorted, 0.9), 2)}, largest ${fixed(summary.sorted[summary.sorted.length - 1] ?? 0, 2)} arcmin.`, '')

    lines.push('### Drift', '')

    if (night.drifts.length === 0) lines.push('No run holds enough fixes to fit.', '')
    else {
      lines.push(
        '| Epoch | From | To | Frames | North (arcsec/min) | East (arcsec/min) | Polar error the speed needs, at least (arcmin) | Alignment evidence then (arcmin) |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      )

      for (const drift of night.drifts) {
        const alignment = alignmentBefore(night.trials, drift.from)

        lines.push(
          `| ${drift.epoch} | ${clock(drift.from)} | ${clock(drift.to)} | ${drift.frames} | ${fixed(drift.northArcsecPerMin, 2)} ± ${fixed(drift.northSe, 2)} | ${fixed(drift.eastArcsecPerMin, 2)} ± ${fixed(drift.eastSe, 2)} | ${fixed(drift.polarLowerArcmin)} | ${alignment ? fixed(alignment.totalArcmin) : 'none'} |`,
        )
      }

      lines.push('')
    }

    lines.push('### Finding', '')

    switch (finding.kind) {
      case 'no-alignment':
        lines.push('No alignment reading came before a fitted run, so drift could not be held against one.')
        break
      case 'steady':
        lines.push(`${finding.tested} fitted runs held against the last alignment reading. None needs more than ${marginArcmin} arcmin above it.`)
        break
      case 'shift': {
        const { shift } = finding
        const first = shift.unkept?.[0]
        const last = shift.unkept?.[shift.unkept.length - 1]
        lines.push(
          `The drift disagrees with the alignment of run ${shift.alignment.runId.slice(0, 8)} (${shift.alignment.outcome}, ${fixed(shift.alignment.totalArcmin, 2)} arcmin at ${when(shift.alignment.at)}). **Earliest bracket the pixels and telemetry support: ${when(shift.from)} to ${when(shift.to)}** (${fixed((shift.to - shift.from) / 60_000)} minutes). The bracket ends where the shortest stretch from the start of the run at ${clock(shift.drift.from)} that disagrees on its own ends (${shift.drift.frames} exposures). That stretch drifts ${fixed(shift.drift.northArcsecPerMin, 2)} arcsec/min north and ${fixed(shift.drift.eastArcsecPerMin, 2)} east. If a polar error caused it, the error is at least ${fixed(shift.drift.polarLowerArcmin)} arcmin.`,
          '',
        )

        if (shift.corroboration !== undefined)
          lines.push(`**Corroborated.** Run ${shift.corroboration.runId.slice(0, 8)} later read ${fixed(shift.corroboration.totalArcmin)} arcmin at ${when(shift.corroboration.at)}, as large as the drift needs. It is not used to place the bracket.`, '')
        else lines.push('**Not corroborated.** No later alignment reading is as large as the drift needs, so a tracking-rate error, flexure or refraction explains the drift as well as a polar error does.', '')

        if (shift.unkept === undefined) lines.push('**Incomplete.** This night has no recording of the camera commands, so the tool cannot say whether pixels inside the bracket were kept.')
        else if (shift.unkept.length === 0) lines.push('Complete: every exposure commanded inside the bracket has kept pixels, so the bracket cannot be narrowed further.')
        else
          lines.push(
            `**Incomplete.** Cria was told to take ${shift.unkept.length} exposures inside the bracket (${first ? clock(first.at) : ''} to ${last ? clock(last.at) : ''}, ${[...new Set(shift.unkept.map(exposure => `${exposure.seconds} s`))].join(' or ')}) and no kept file matches them. Their pixels would narrow the bracket.`,
          )

        break
      }
    }

    lines.push('')
  }

  const listed = report.nights.find(night => night.night === report.listed)

  if (listed !== undefined) {
    lines.push(`## Frames of night ${listed.night}`, '', '| Captured | Exposure (s) | Solve | Join | Epoch | East (arcmin) | North (arcmin) | Total (arcmin) | Alignment then (arcmin) | Alignment age (min) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')

    for (const row of listed.rows) {
      const pointing = pointingOf(row)
      const alignment = alignmentBefore(listed.trials, row.midpoint)

      lines.push(
        `| ${clock(row.capturedAt)} | ${row.exposureSeconds} | ${row.solve} | ${pointing.kind === 'fix' ? 'fix' : pointing.reason} | ${pointing.kind === 'fix' ? pointing.epoch : ''} | ${pointing.kind === 'fix' ? fixed(pointing.arcmin.east, 2) : ''} | ${pointing.kind === 'fix' ? fixed(pointing.arcmin.north, 2) : ''} | ${pointing.kind === 'fix' ? fixed(pointing.arcmin.total, 2) : ''} | ${alignment ? fixed(alignment.totalArcmin) : ''} | ${alignment ? fixed((row.midpoint - alignment.at) / 60_000) : ''} |`,
      )
    }

    lines.push('')
  }

  return `${lines.join('\n')}\n`
}
