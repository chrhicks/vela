import type { FastifyInstance } from 'fastify'
import type { RigCatalog } from '../rig/catalog.js'
import type { SavedImageStore } from './store.js'
import { PREVIEW_VERSION } from '../imaging/background.js'

export function registerSavedImages(
  app: FastifyInstance,
  catalog: RigCatalog,
  store: SavedImageStore,
) {
  app.get<{ Params: { rigId: string } }>(
    '/api/web/rigs/:rigId/saved-images',
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const rig = await catalog.get(request.params.rigId)

      if (!rig) return reply.code(404).send({ error: 'Rig not found' })

      try {
        return { rigId: rig.id, rigName: rig.name, images: await store.list(rig.id) }
      } catch (error) {
        request.log.error(error, 'Could not read saved images')

        return reply
          .code(503)
          .send({ error: 'Saved images are unavailable. Check storage and try again.' })
      }
    },
  )

  app.get<{ Params: { rigId: string; imageId: string } }>(
    '/api/web/rigs/:rigId/saved-images/:imageId',
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      const { rigId, imageId } = request.params
      const rig = await catalog.get(rigId)

      if (!rig) return reply.code(404).send({ error: 'Rig not found' })

      try {
        const image = await store.refreshPreview(rigId, imageId)

        return image
          ? { rigId, rigName: rig.name, image }
          : reply.code(404).send({ error: 'Saved image not found' })
      } catch (error) {
        request.log.error(error, 'Could not read saved image')

        return reply
          .code(503)
          .send({ error: 'Saved image is unavailable. Check storage and try again.' })
      }
    },
  )

  const resources = [
    { suffix: 'preview', kind: 'native', type: 'image/png', download: false },
    { suffix: 'fit', kind: 'fit', type: 'image/png', download: false },
    { suffix: 'fits', kind: 'fits', type: 'application/fits', download: true },
    { suffix: 'download-preview', kind: 'native', type: 'image/png', download: true },
  ] as const

  for (const resource of resources) {
    for (const versioned of resource.kind === 'fits' ? [false] : [false, true]) {
      const path = `/api/rigs/:rigId/saved-images/:imageId/${versioned ? 'previews/:version/' : ''}${resource.suffix}`
      app.get<{ Params: { rigId: string; imageId: string; version?: string } }>(
        path,
        async (request, reply) => {
          const { rigId, imageId } = request.params

          if (versioned && request.params.version !== PREVIEW_VERSION)
            return reply.code(404).send({ error: 'Unknown preview version' })

          if (!(await catalog.get(rigId))) return reply.code(404).send({ error: 'Rig not found' })

          try {
            const metadata = await store.get(rigId, imageId)

            if (!metadata) return reply.code(404).send({ error: 'Saved image not found' })

            const file =
              versioned && resource.kind !== 'fits'
                ? await store.previewFile(rigId, imageId, resource.kind)
                : await store.file(rigId, imageId, resource.kind)

            if (!file) return reply.code(404).send({ error: 'Saved image file not found' })

            if (resource.download) {
              const stamp = metadata.capturedAt.replace(/[^0-9T]/g, '-')
              const name = `capture-${stamp}-${encodeURIComponent(imageId)}.${resource.kind === 'fits' ? 'fits' : 'png'}`
              reply.header('content-disposition', `attachment; filename="${name}"`)
            }

            return reply
              .type(resource.type)
              .header('cache-control', 'private, max-age=3600, immutable')
              .send(file)
          } catch (error) {
            request.log.error(error, 'Could not read saved image file')

            return reply
              .code(503)
              .send({ error: 'Saved file is unavailable. Check storage and try again.' })
          }
        },
      )
    }
  }
}
