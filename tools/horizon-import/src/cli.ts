import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { horizonFilePath, writeHorizonProfile } from '@vela/server/targets/horizon'
import { convertSurvey, surveySchema } from './convert.ts'

const usage = `usage: horizon-import SURVEY_JSON --rig RIG_ID --dir DATA_DIR --az-offset DEG --alt-offset DEG [--step DEG]

Converts a horizon survey (horizon-data.json) into DATA_DIR/horizon-RIG_ID.json, mode 600.
DATA_DIR is Vela's data directory, the one that holds rigs.yaml. The offsets have no defaults.
--step is the output bin size in degrees, default 1; it must divide 360.
Prints counts only, never altitudes.`

function fail(message: string): never {
  console.error(`${message}\n\n${usage}`)
  process.exit(2)
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rig: { type: 'string' },
    dir: { type: 'string' },
    'az-offset': { type: 'string' },
    'alt-offset': { type: 'string' },
    step: { type: 'string', default: '1' },
  },
})

const [source] = positionals

const { rig, dir } = values

if (!source || positionals.length !== 1 || !rig || !dir || !values['az-offset'] || !values['alt-offset'])
  fail('Missing or extra arguments.')

const path = horizonFilePath(resolve(dir), rig)

if (!path) fail('The rig id may use only letters, digits, hyphens and underscores.')

try {
  const { profile, traced, unknown } = convertSurvey(surveySchema.parse(JSON.parse(await readFile(source, 'utf8'))), {
    azimuthOffsetDegrees: Number(values['az-offset']),
    altitudeOffsetDegrees: Number(values['alt-offset']),
    stepDegrees: Number(values.step),
    importedAt: new Date(),
  })

  await writeHorizonProfile(path, profile)
  console.log(`wrote ${path}: ${profile.altitudesDegrees.length} bins, ${traced} traced, ${unknown} unknown`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
