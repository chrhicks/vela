import type { FastifyInstance } from 'fastify'
import type { ImagingCameraView } from '@vela/model/web'
import type { RigCatalog } from './catalog.js'
import type { RigOperations } from './operations.js'
import { inspectRigDetail, type RigDetailOptions } from './detail.js'

export function registerImagingCamera(app: FastifyInstance, catalog: RigCatalog, operations: RigOperations, options: RigDetailOptions = {}) {
  async function inspect(rigId: string): Promise<ImagingCameraView | undefined> {
    const detail = await inspectRigDetail(catalog, rigId, options)
    if (detail.state === 'not-found') return undefined
    const rig = await catalog.get(rigId)
    if (!rig) return undefined
    const cameras = detail.state === 'current' ? detail.inspections
      .filter(device => device.kind === 'camera')
      .map(device => ({ id: device.providerDeviceId, name: device.name?.trim() || null, configuredName: device.configuredName })) : []
    const selected = rig.imagingCamera
    const match = cameras.find(camera => camera.id === selected?.uniqueId)
    return {
      rigId, cameras,
      selected: selected ? { id: selected.uniqueId, name: selected.name } : null,
      state: detail.state !== 'current' ? 'unavailable' : !selected ? 'unselected'
        : !match ? 'missing' : !match.name ? 'unavailable' : match.name !== selected.name ? 'changed' : 'ready',
      editable: detail.state === 'current' && !operations.owner(rigId),
    }
  }

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/imaging-camera', async (request, reply) =>
    await inspect(request.params.rigId) ?? reply.code(404).send({ error: 'Rig not found' }))

  app.put<{ Params: { rigId: string } }>('/api/rigs/:rigId/imaging-camera', async (request, reply) => {
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
      || !('id' in body) || typeof body.id !== 'string' || !('name' in body) || typeof body.name !== 'string') {
      return reply.code(400).send({ error: 'Expected camera id and name.' })
    }
    const release = operations.acquire(request.params.rigId, 'imaging-camera')
    if (!release) return reply.code(409).send({ error: 'Another Rig operation is in progress.' })
    try {
      const view = await inspect(request.params.rigId)
      if (!view) return reply.code(404).send({ error: 'Rig not found' })
      const camera = view.cameras.find(camera => camera.id === body.id)
      if (!camera?.name || camera.name !== body.name) return reply.code(409).send({ error: 'Camera identity changed or is unavailable. Refresh and select it again.' })
      const saved = await catalog.setImagingCamera(view.rigId, { uniqueId: camera.id, name: camera.name })
      if (!saved) return reply.code(404).send({ error: 'Rig not found' })
      return { ...view, selected: { id: camera.id, name: camera.name }, state: 'ready', editable: true }
    } finally { release() }
  })
}
