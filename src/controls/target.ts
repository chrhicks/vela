import { Context, Effect } from 'effect'
import type { CaptureRequest } from '../capture/request.ts'
import type { CatalogTarget } from '../catalog/types.ts'
import type { Done } from '../../state/commands.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { Capturing } from './camera.ts'

export class TargetCatalog extends Context.Service<TargetCatalog, { readonly find: (id: string) => CatalogTarget | undefined }>()('vela/TargetCatalog') {}

export const targetControls = Effect.gen(function* () {
  const feed = yield* Feed
  const capturing = yield* Capturing
  const catalog = yield* TargetCatalog

  return {
    startTarget: (id: string, exposureSeconds: number, frames: number | undefined) =>
      Effect.gen(function* () {
        const target = catalog.find(id)

        if (target === undefined) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'unknown-target', text: id } }))

        const controls = (yield* feed.current).devices.primary.CCD_CONTROLS?.values
        const gain = controls?.Gain
        const offset = controls?.Offset

        if (gain === undefined || offset === undefined) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'not-connected', device: 'primary' } }))
        if (yield* capturing.busy) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'run-active' } }))

        const request: CaptureRequest = {
          object: target.name,
          frameType: 'light',
          exposureSeconds,
          ...(frames === undefined ? {} : { count: frames }),
          gain,
          offset,
          cooler: 'keep',
          target: { id: target.id, name: target.name, raDegrees: target.raDegrees, decDegrees: target.decDegrees },
        }

        yield* capturing.start(request)

        return { code: 'capturing-target', name: target.name, exposureSeconds, ...(frames === undefined ? {} : { frames }) } satisfies Done
      }),
  }
})
