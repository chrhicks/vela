import { Context } from 'effect'
import { HttpRouter } from 'effect/http'
import { expect, it } from 'vitest'
import { detailSurveyPath, surveyPath, type Survey } from '../../state/survey.ts'
import { DetailSurveyKept, DetailSurveyRoute, SurveyKept, SurveyRoute } from './survey.ts'

const survey: Survey = { name: 'DSS colored', credit: 'Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS', address: 'https://survey.test/DSSColor', order: 4, tileWidth: 512, tiles: 3072, pulledAt: '2026-01-01T00:00:00.000Z' }

async function get(kept: Survey | null) {
  const { handler, dispose } = HttpRouter.toWebHandler(SurveyRoute, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${surveyPath}`), Context.make(SurveyKept, { survey: kept, tilesDir: '/nowhere' }))
  const body = await response.json()

  await dispose()

  return { status: response.status, body }
}

it('GET /sky-survey answers with the survey that was downloaded, or with nothing', async () => {
  expect(await get(survey)).toEqual({ status: 200, body: survey })
  expect(await get(null)).toEqual({ status: 200, body: null })
})

it('GET /sky-detail-survey answers with the detail survey, apart from the one behind the thumbnail', async () => {
  const detail: Survey = { ...survey, order: 7, tiles: 196608 }
  const { handler, dispose } = HttpRouter.toWebHandler(DetailSurveyRoute, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${detailSurveyPath}`), Context.make(DetailSurveyKept, { survey: detail, tilesDir: '/nowhere' }))

  expect(await response.json()).toEqual(detail)
  await dispose()
})
