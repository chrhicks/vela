import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { replayAlignmentDiagnostics } from './diagnostic-replay.js'

const root = process.env.VELA_RECORDED_TRIALS ?? join(homedir(), '.local/share/vela/alignment-diagnostics/trials')

/** What the mount-rigidity tool concluded about each recorded baseline (home repo, `bots/observer/specs/build-plan/reports/step-10-rigidity.md`). */
const recorded = {
  '05a23dc4': 'not-rigid',
  '0ded133c': 'rigid',
  '1bca7470': 'rigid',
  '1f0400ca': 'rigid',
  '24390f55': 'not-rigid',
  '276a6878': 'rigid',
  '283799f5': 'not-rigid',
  '2bfbf00c': 'not-rigid',
  '47720be5': 'not-rigid',
  '52ed1f1c': 'not-rigid',
  '53720a67': 'not-rigid',
  '62fb84dc': 'not-rigid',
  '6f2a08e0': 'not-rigid',
  '7af61c11': 'not-rigid',
  '836f1c70': 'rigid',
  'ce42bbb0': 'not-rigid',
  'dcb0400b': 'rigid',
  'eeef34da': 'rigid',
  'f023bbb6': 'not-rigid',
} as const

const folders = existsSync(root) ? readdirSync(root) : []

/** On 2026-10-31 these two finished at a few tenths of an arcminute while the telescope clamp was loose. */
const readSmallWhileLoose = ['24390f55', '6f2a08e0']

describe.skipIf(folders.length === 0)('recorded alignment trials, replayed through Vela’s alignment code', () => {
  for (const [trial, status] of Object.entries(recorded)) {
    const folder = folders.find(name => name.startsWith(trial))

    it.skipIf(folder === undefined)(`${trial} is judged ${status}`, async () => {
      const report = await replayAlignmentDiagnostics(join(root, folder!))

      expect(report.rigidity?.status).toBe(status)
    })
  }

  it.each(readSmallWhileLoose)('%s, which finished at a small number, is judged not rigid', async trial => {
    const folder = folders.find(name => name.startsWith(trial))

    if (folder === undefined) return

    const report = await replayAlignmentDiagnostics(join(root, folder))

    expect(report.rigidity?.status).toBe('not-rigid')
    expect(report.finalMeasurement?.totalArcsec).toBeLessThan(60)
  })
})
