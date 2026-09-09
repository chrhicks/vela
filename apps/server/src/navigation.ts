import type { FastifyInstance } from 'fastify'
import type { NavigationCapture, NavigationView } from '@vela/model/web'
import type { RigCatalog } from './rig/catalog.js'

export function registerNavigation(
  app: FastifyInstance,
  catalog: Pick<RigCatalog, 'list'>,
  capture: { snapshot(rigId: string): NavigationCapture | undefined },
) {
  app.get('/api/web/navigation', async (): Promise<NavigationView> => {
    const rigs = (await catalog.list()).map(({ id, name }) => ({ id, name }))
    const captures = rigs.flatMap(rig => {
      const current = capture.snapshot(rig.id)
      return current ? [{ ...current, rigName: rig.name }] : []
    })
    return { rigs, captures }
  })
}
