import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Effect, Option, Schema } from 'effect'
import { NightName } from '../../state/entries.ts'
import { readConfig } from '../config.ts'
import { runHandledPromise } from '../edge.ts'
import { VelaSettings } from '../settings.ts'
import { buildHorizon } from '../sweep/horizon-night.ts'

const { values, positionals } = parseArgs({ args: process.argv.slice(2), options: { sweep: { type: 'string', default: '' }, out: { type: 'string' } }, allowPositionals: true })
const [configPath, night] = positionals
const settings = readConfig(VelaSettings, configPath)
const nightName = Schema.decodeUnknownOption(NightName)(night)

const failed = (reason: string) =>
  Effect.sync(() => {
    console.error(`sweep-horizon: ${reason}`)
    process.exitCode = 1
  })

await runHandledPromise(
  Option.isNone(nightName)
    ? failed('usage: sweep-horizon.ts <config.json> <night YYYY-MM-DD> [--sweep ID-PREFIX] [--out FILE]')
    : buildHorizon({ recordsFolder: join(settings.sweep.recordDir, nightName.value), night: nightName.value, out: values.out ?? settings.horizonFile, sweepPrefix: values.sweep, settings: settings.sweep, now: Date.now }).pipe(
        Effect.flatMap(({ sweep, fromCells, fromColumns, unknown, kept, backup }) =>
          Effect.sync(() => {
            console.log(`sweep-horizon: ${sweep}: ${fromCells} bins from cells, ${fromColumns} from columns, ${kept} kept from the file before, ${unknown} unknown`)
            if (backup !== undefined) console.log(`sweep-horizon: the file before is kept as ${backup}`)
          }),
        ),
        Effect.catchTags({
          HorizonRecordsUnreadable: ({ path, reason }) => failed(`could not read ${path}: ${reason}`),
          HorizonUnwritable: ({ path, reason }) => failed(`could not write ${path}: ${reason}`),
          HorizonUnreadable: ({ path, reason }) => failed(`the horizon file ${path} is unreadable, so it was left as it is: ${reason}`),
          SweepNotOne: ({ prefix, found }) => failed(found.length === 0 ? `no sweep starts with "${prefix}" in the records` : `"${prefix}" matches ${found.length} sweeps (${found.join(', ')}); give a longer --sweep`),
        }),
      ),
)
