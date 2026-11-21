import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Effect } from 'effect'
import { readConfig } from '../config.ts'
import { runHandledPromise } from '../edge.ts'
import { nightPattern } from '../frames/night.ts'
import { VelaSettings } from '../settings.ts'
import { labelNight, measureWithAstap } from '../sweep/cell-night.ts'

const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { sweep: { type: 'string', default: '' }, out: { type: 'string' } }, allowPositionals: true })
const [configPath, night] = positionals
const settings = readConfig(VelaSettings, configPath)

const failed = (reason: string) =>
  Effect.sync(() => {
    console.error(`sweep-cells: ${reason}`)
    process.exitCode = 1
  })

const { site } = settings.sweep.cells

await runHandledPromise(
  night === undefined || !nightPattern.test(night)
    ? failed('usage: sweep-cells.ts <config.json> <night YYYY-MM-DD> [--sweep ID-PREFIX] [--out FOLDER]')
    : settings.stars === undefined
      ? failed('the config has no stars setting, so there is no ASTAP program to run')
      : site === undefined
        ? failed('the config has no sweep.cells.site: the cells are placed in the sky for that site')
        : labelNight({
            recordsFolder: join(settings.sweep.recordDir, night),
            framesFolder: join(settings.frames.keepDir, night),
            outFolder: values.out ?? join(settings.sweep.recordDir, night),
            sweepPrefix: values.sweep,
            settings: settings.sweep,
            site,
            measure: measureWithAstap(settings.stars, settings.sweep.cells),
            now: Date.now,
          }).pipe(
            Effect.flatMap(({ frames, edges, failures, seconds }) =>
              Effect.sync(() => {
                console.log(`sweep-cells: ${frames} frames and ${edges} bins in ${seconds.toFixed(1)} s`)
                for (const { file, reason } of failures) console.error(`sweep-cells: ${file} was left out: ${reason}`)
                if (failures.length > 0) process.exitCode = 1
              }),
            ),
            Effect.catchTags({
              CellRecordsUnreadable: ({ path, reason }) => failed(`could not read ${path}: ${reason}`),
              CellOutputUnwritable: ({ path, reason }) => failed(`could not write ${path}: ${reason}`),
            }),
          ),
)
