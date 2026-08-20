import type { IsoDateTime, RigView } from '../rig/index.js'

export interface HomeView {
  readonly rigs: ReadonlyArray<RigView>
  readonly refreshedAt: IsoDateTime
}
