import { z } from 'zod'
import { isAbsolute } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { createAlpacaAcquisition, createAlpacaFraming } from '@vela/alpaca'
import type { Acquisition, Framing } from '@vela/equipment'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { alpacaEndpoint } from '../equipment/source.js'
import { inspectRigDetail, type RigDetailOptions } from '../rig/detail.js'
import type { AlignmentView } from '@vela/model/web'
import { createRigOperations, type RigOperations } from '../rig/operations.js'
import type { RigCatalog } from '../rig/catalog.js'
import { createAlignmentController, type AlignmentSettings } from './controller.js'
import { createAstapSolver } from './solver.js'
import { createPhysicalAlignment } from './physical.js'
import { createAlignmentDiagnostics } from './diagnostics.js'

export interface AlignmentFactories {
  acquisition: (options: { baseUrl: string }) => Acquisition
  framing: (options: { baseUrl: string }) => Framing
  physical: typeof createPhysicalAlignment
  solver: typeof createAstapSolver
  controller: typeof createAlignmentController
}

const defaultFactories: AlignmentFactories = {
  acquisition: createAlpacaAcquisition,
  framing: createAlpacaFraming,
  physical: createPhysicalAlignment,
  solver: createAstapSolver,
  controller: createAlignmentController,
}

export interface AlignmentEquipmentOptions {
  settingsForRig?: (rig: RigCatalogRecord) => AlignmentSettings | undefined
  createAcquisition?: (rig: RigCatalogRecord) => Acquisition
  createFraming?: (rig: RigCatalogRecord) => Framing
  createInspector?: RigDetailOptions['createInspector']
}

const emptyCommand = z.object({}).strict()

export function registerAlignment(
  app: FastifyInstance,
  catalog: RigCatalog,
  legacySettings?: AlignmentSettings,
  operations: RigOperations = createRigOperations(),
  factories: AlignmentFactories = defaultFactories,
  equipment: AlignmentEquipmentOptions = {},
) {
  function configuredSettings(rig: RigCatalogRecord) {
    return rig.source ? equipment.settingsForRig?.(rig) : legacySettings
  }

  const settings = legacySettings

  const openDiagnostics = settings?.diagnosticsPath
    ? createAlignmentDiagnostics(settings.diagnosticsPath, error =>
        app.log.error(
          { err: error },
          'Alignment diagnostic recording stopped; observing operation continues',
        ),
      )
    : undefined

  let alignment =
    settings && settings.mode !== 'physical'
      ? factories.controller({
          mode: 'offline',
          settings,
          openDiagnostics,
          hardware: factories.acquisition({ baseUrl: settings.endpoint }),
          solver: factories.solver({
            executable: settings.executable,
            catalogPath: settings.catalogPath,
            fieldHeightDegrees: settings.fieldHeightDegrees,
          }),
        })
      : undefined

  function createRun(rig: RigCatalogRecord, settings: AlignmentSettings) {
    const acquisition = equipment.createAcquisition?.(rig) ??
      factories.acquisition({ baseUrl: alpacaEndpoint(rig) })

    const openDiagnostics = settings.diagnosticsPath
      ? createAlignmentDiagnostics(settings.diagnosticsPath, error =>
          app.log.error({ err: error }, 'Alignment diagnostic recording stopped'),
        )
      : undefined

    if (settings.mode !== 'physical') {
      return factories.controller({
        mode: 'offline',
        settings,
        hardware: acquisition,
        openDiagnostics,
        solver: factories.solver({
          executable: settings.executable,
          catalogPath: settings.catalogPath,
          fieldHeightDegrees: settings.fieldHeightDegrees,
        }),
      })
    }

    const physical = factories.physical(
      {
        cameraId: settings.cameraId,
        telescopeId: settings.telescopeId,
        cameraName: rig.imagingCamera!.name,
        focalLengthMm: rig.focalLengthMm!,
      },
      acquisition,
      equipment.createFraming?.(rig) ?? factories.framing({ baseUrl: alpacaEndpoint(rig) }),
    )

    return factories.controller({
      mode: 'physical',
      settings,
      hardware: acquisition,
      physical,
      openDiagnostics,
      createSolver: fieldHeightDegrees => factories.solver({
        executable: settings.executable,
        catalogPath: settings.catalogPath,
        fieldHeightDegrees,
      }),
    })
  }

  async function rigView(rigId: string): Promise<AlignmentView | undefined> {
    const rig = await catalog.get(rigId)

    if (!rig) return undefined
    const settings = configuredSettings(rig)
    const endpoint = `http://${rig.endpoint.host}:${rig.endpoint.port}`
    let inventory = rig.lastObservedInventory.devices
    let equipmentReason: string | null = null

    if (rig.source && settings && equipment.createInspector) {
      const detail = await inspectRigDetail(catalog, rig.id, { createInspector: equipment.createInspector })

      if (detail.state !== 'current') {
        equipmentReason = 'Rig identity or equipment state needs attention before alignment.'
      } else {
        inventory = detail.inspections.map(device => ({
          uniqueId: device.providerDeviceId,
          kind: device.kind,
          name: device.configuredName,
        }))

        if (!alignment?.active() || alignment.snapshot().rigId !== rig.id) {
          const blocked = detail.inspections.find(device =>
            (device.providerDeviceId === settings.cameraId || device.providerDeviceId === settings.telescopeId) &&
            (device.connection !== 'connected' || device.observation?.commandReady === false),
          )

          if (blocked)
            equipmentReason = blocked.observation?.message ?? 'Fresh connected equipment state is required before alignment.'
        }
      }
    }

    const configured =
      !!settings &&
      (rig.source ? settings.rigId === rig.id : endpoint === settings.endpoint) &&
      inventory.some(
        device => device.uniqueId === settings.cameraId && device.kind === 'camera',
      ) &&
      inventory.some(
        device => device.uniqueId === settings.telescopeId && device.kind === 'telescope',
      )

    const owner = operations.owner(rigId)

    let reason: string | null = null

    if (!configured) {
      reason = 'Polar alignment is not configured for this Rig.'
    } else if (equipmentReason) {
      reason = equipmentReason
    } else if (owner && owner !== 'alignment') {
      reason = 'Another Rig operation is in progress.'
    } else if (settings?.mode === 'physical' && rig.imagingCamera?.uniqueId !== settings.cameraId) {
      reason = 'Select the configured imaging camera on Observe before alignment.'
    } else if (settings?.mode === 'physical' && !rig.focalLengthMm) {
      reason = 'Set the effective focal length before alignment.'
    }

    const empty: AlignmentView = {
      rigId,
      rigName: rig.name,
      enabled: !reason,
      unavailableReason: reason,
      phase: 'setup',
      activity: 'idle',
      active: false,
      position: 0,
      solvedPositions: 0,
      exposureSeconds: settings?.exposureSeconds ?? 2,
      exposureStartedAt: null,
      measuredAt: null,
      warning: null,
      error: null,
      measurement: null,
    }

    const state = alignment?.snapshot()

    const sameRun = state && (state.rigId === rigId || (!state.rigId && !rig.source))
    const view = sameRun ? { ...empty, ...state } : empty
    view.rigId = rigId
    view.rigName = rig.name
    view.enabled = !reason
    view.unavailableReason = reason

    if (settings?.mode === 'physical') {
      view.mode = 'physical'

      if (rig.imagingCamera) view.cameraName = rig.imagingCamera.name
    }

    return view
  }

  app.get<{ Params: { rigId: string } }>(
    '/api/web/rigs/:rigId/alignment',
    async (request, reply) => {
      const view = await rigView(request.params.rigId)

      return view ?? reply.code(404).send({ error: 'Rig not found' })
    },
  )
  app.post<{ Params: { rigId: string; command: string } }>(
    '/api/rigs/:rigId/alignment/:command',
    async (request, reply) =>
      trace.getTracer('vela.alignment').startActiveSpan(
        'alignment.command',
        {
          attributes: {
            'alignment.command': request.params.command,
            'rig.id': request.params.rigId,
            'http.request.id': request.id,
          },
        },
        async span => {
          try {
            if (
              !request.headers['content-type']?.startsWith('application/json') ||
              !emptyCommand.safeParse(request.body).success
            )
              return reply.code(400).send({ error: 'Expected an empty JSON object' })

            const release =
              request.params.command === 'start'
                ? operations.acquire(request.params.rigId, 'alignment')
                : undefined

            if (request.params.command === 'start' && !release)
              return reply.code(409).send({ error: 'Another Rig operation is in progress' })
            let started = false

            try {
              const view = await rigView(request.params.rigId)

              if (!view) return reply.code(404).send({ error: 'Rig not found' })

              // Stop remains available to the operation's rig even if saved settings
              // change while it is running.
              if (
                (request.params.command === 'stop' || request.params.command === 'finish') &&
                alignment?.snapshot().rigId === view.rigId
              ) {
                return await alignment.stop(request.params.command === 'finish')
              }

              const rig = await catalog.get(view.rigId)
              const settings = rig && configuredSettings(rig)

              if (!view.enabled || !settings || !rig)
                return reply.code(409).send({ error: view.unavailableReason })

              if (request.params.command === 'start') {
                if (alignment?.active()) throw new Error('A measurement is already running')

                if (settings.mode === 'physical' || rig.source)
                  alignment = createRun(rig, settings)

                if (!alignment) throw new Error('Polar alignment is not configured')
                const result = await alignment.start(view.rigId, view.rigName, release)
                started = true

                return result
              }

              if (request.params.command === 'stop' || request.params.command === 'finish') {
                return reply
                  .code(409)
                  .send({ error: 'There is no alignment measurement for this Rig.' })
              }

              return reply.code(404).send({ error: 'Unknown alignment command' })
            } catch (error) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: error instanceof Error ? error.message : 'Alignment command failed',
              })

              if (error instanceof Error) span.recordException(error)

              return reply.code(409).send({
                error: error instanceof Error ? error.message : 'Alignment command failed',
              })
            } finally {
              if (!started) release?.()
            }
          } finally {
            span.setAttribute('http.response.status_code', reply.statusCode)
            span.end()
          }
        },
      ),
  )
  app.get<{ Params: { rigId: string; imageId: string } }>(
    '/api/rigs/:rigId/alignment/images/:imageId',
    async (request, reply) => {
      const view = await rigView(request.params.rigId)

      const image =
        view && alignment?.snapshot().rigId === request.params.rigId
          ? alignment.image(request.params.imageId)
          : undefined

      if (!image) return reply.code(404).send({ error: 'Frame no longer available' })

      return reply
        .type('image/png')
        .header('cache-control', 'private, max-age=3600, immutable')
        .send(image)
    },
  )
  app.addHook('onClose', async () => {
    await alignment?.stop()
  })

  return { active: (rigId: string) => alignment?.active() && alignment.snapshot().rigId === rigId }
}

export function alignmentSettings(env: NodeJS.ProcessEnv): AlignmentSettings | undefined {
  if (!env.VELA_ALIGNMENT_ENDPOINT) return undefined
  const endpoint = new URL(env.VELA_ALIGNMENT_ENDPOINT)

  if (
    endpoint.protocol !== 'http:' ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error('Invalid VELA_ALIGNMENT_ENDPOINT')
  }

  if (
    !env.VELA_ASTAP ||
    !env.VELA_STAR_CATALOG ||
    !env.VELA_ALIGNMENT_CAMERA_ID ||
    !env.VELA_ALIGNMENT_TELESCOPE_ID
  )
    throw new Error('Alignment requires solver, catalog and configured device IDs')

  if (
    env.VELA_ALIGNMENT_MODE !== undefined &&
    !['offline', 'physical'].includes(env.VELA_ALIGNMENT_MODE)
  )
    throw new Error('Invalid VELA_ALIGNMENT_MODE')

  const settings: AlignmentSettings = {
    endpoint: endpoint.origin,
    cameraId: env.VELA_ALIGNMENT_CAMERA_ID,
    telescopeId: env.VELA_ALIGNMENT_TELESCOPE_ID,
    executable: env.VELA_ASTAP,
    catalogPath: env.VELA_STAR_CATALOG,
    exposureSeconds: 2,
    fieldHeightDegrees: 3,
  }

  if (env.VELA_ALIGNMENT_MODE === 'physical') settings.mode = 'physical'

  if (env.VELA_ALIGNMENT_DIAGNOSTICS_PATH !== undefined) {
    if (!isAbsolute(env.VELA_ALIGNMENT_DIAGNOSTICS_PATH))
      throw new Error('VELA_ALIGNMENT_DIAGNOSTICS_PATH must be an absolute directory path')
    settings.diagnosticsPath = env.VELA_ALIGNMENT_DIAGNOSTICS_PATH
  }

  return settings
}
