import { Context, Effect } from 'effect'
import { HttpRouter } from 'effect/http'
import { expect, it } from 'vitest'
import { rememberedPath, type RememberedAnswer } from '../../state/remembered.ts'
import { Recalled, RememberedRoute } from './remembered.ts'

it('GET /remembered answers with the last light run and the camera angle', async () => {
  const remembered: RememberedAnswer = { lastLight: { exposureSeconds: 120, frames: null }, cameraAngleDegrees: 109.3 }
  const { handler, dispose } = HttpRouter.toWebHandler(RememberedRoute, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${rememberedPath}`), Context.make(Recalled, { now: Effect.succeed(remembered) }))

  expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: remembered })
  await dispose()
})
