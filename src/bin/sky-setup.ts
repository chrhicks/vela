import { Effect, Layer } from 'effect'
import { readConfig } from '../config.ts'
import { runHandledPromise } from '../edge.ts'
import { VelaSettings } from '../settings.ts'
import { downloadSurvey, SurveySettings } from '../sky/survey.ts'

const settings = readConfig(VelaSettings, process.argv[2])

const failed = (reason: string) =>
  Effect.sync(() => {
    console.error(`sky: ${reason}`)
    process.exitCode = 1
  })

await runHandledPromise(
  downloadSurvey.pipe(
    Effect.provide(Layer.succeed(SurveySettings, settings.sky)),
    Effect.flatMap(({ survey, fetched, tilesDir }) => Effect.sync(() => console.log(`sky: ${survey.name}, ${survey.tiles} tiles at order ${survey.order} in ${tilesDir}; ${fetched} downloaded now`))),
    Effect.catchTags({
      SurveyUnreachable: ({ address, reason }) => failed(`could not download ${address}: ${reason}. Run it again to carry on from the tiles already kept`),
      SurveyUnwritable: ({ path, reason }) => failed(`could not write ${path}: ${reason}`),
    }),
  ),
)
