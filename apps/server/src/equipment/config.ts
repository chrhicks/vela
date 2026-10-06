import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigEndpoint } from '@vela/model/rig'

const identifier = z.string().min(1).max(128).refine(value => value.trim() === value)

const deviceSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  kind: z.enum(['camera', 'mount', 'focuser', 'weather', 'switch']),
  expectedName: z.string().min(1).max(256).refine(value => value.trim() === value),
})

const rigSchema = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1),
  url: z.url().refine(value => {
    const url = new URL(value)

    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password
  }, 'Cria URL must be an HTTP(S) origin without credentials'),
  tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  storeId: z.uuid(),
  devices: z.array(deviceSchema).min(1),
  imagingCameraId: identifier.max(64).optional(),
  focalLengthMm: z.number().min(10).max(20000).optional(),
  alignment: z.strictObject({
    mode: z.enum(['physical', 'offline']),
    cameraId: identifier.max(64),
    telescopeId: identifier.max(64),
    exposureSeconds: z.number().min(0.1).max(60).optional(),
  }).optional(),
}).superRefine((rig, context) => {
  if (new Set(rig.devices.map(device => device.id)).size !== rig.devices.length)
    context.addIssue({ code: 'custom', message: 'Cria device IDs must be unique within a rig' })

  function hasDevice(id: string, kind: z.infer<typeof deviceSchema>['kind']) {
    return rig.devices.some(device => device.id === id && device.kind === kind)
  }

  if (rig.imagingCameraId && !hasDevice(rig.imagingCameraId, 'camera'))
    context.addIssue({ code: 'custom', message: 'Imaging camera must name a configured camera' })

  if (rig.alignment && (
    !hasDevice(rig.alignment.cameraId, 'camera') ||
    !hasDevice(rig.alignment.telescopeId, 'mount')
  )) {
    context.addIssue({ code: 'custom', message: 'Alignment must name a configured camera and mount' })
  }
})

const configurationSchema = z.strictObject({ rigs: z.array(rigSchema) }).superRefine((value, context) => {
  if (new Set(value.rigs.map(rig => rig.id)).size !== value.rigs.length)
    context.addIssue({ code: 'custom', message: 'Cria rig IDs must be unique' })

  const services = new Map<string, { storeId: string; tokenEnv: string }>()
  const deviceOwners = new Set<string>()

  for (const rig of value.rigs) {
    const origin = new URL(rig.url).origin
    const previous = services.get(origin)

    if (previous && (previous.storeId !== rig.storeId || previous.tokenEnv !== rig.tokenEnv)) {
      context.addIssue({ code: 'custom', message: 'A Cria origin must use one store and token variable' })
    }

    services.set(origin, { storeId: rig.storeId, tokenEnv: rig.tokenEnv })

    for (const device of rig.devices) {
      const identity = `${origin}/${device.id}`

      if (deviceOwners.has(identity))
        context.addIssue({ code: 'custom', message: 'A Cria device may belong to only one configured rig' })
      deviceOwners.add(identity)
    }
  }
})

export type CriaConfiguredDevice = z.infer<typeof deviceSchema>

export type CriaRigConfiguration = z.infer<typeof rigSchema> & { readonly token: string }

export function parseCriaConfiguration(contents: string, environment: NodeJS.ProcessEnv): CriaRigConfiguration[] {
  let parsed: z.infer<typeof configurationSchema>

  try {
    parsed = configurationSchema.parse(JSON.parse(contents))
  } catch {
    throw new Error('Invalid Cria configuration. Check the server configuration schema.')
  }

  return parsed.rigs.map(rig => {
    const token = environment[rig.tokenEnv]

    // oxlint-disable-next-line no-control-regex -- Reject invalid HTTP bearer-token characters.
    if (!token || token.length < 32 || token.trim() !== token || /[\u0000-\u001f\u007f-\u009f]/.test(token))
      throw new Error(`Cria token environment variable ${rig.tokenEnv} must contain at least 32 characters.`)

    return { ...rig, url: new URL(rig.url).origin, token }
  })
}

export async function loadCriaConfiguration(
  path: string | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<ReadonlyArray<CriaRigConfiguration>> {
  if (!path) return []

  return parseCriaConfiguration(await readFile(path, 'utf8'), environment)
}

export function criaDeviceId(configuration: Pick<CriaRigConfiguration, 'id' | 'storeId'>, deviceId: string): string {
  return `cria:${encodeURIComponent(configuration.id)}:${configuration.storeId}:${encodeURIComponent(deviceId)}`
}

export function criaEndpoint(configuration: Pick<CriaRigConfiguration, 'url'>): RigEndpoint {
  const url = new URL(configuration.url)

  return { host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) }
}

/** Configuration declares ownership and selections; only adapter reads establish inventory. */
export async function registerConfiguredCriaRigs(
  catalog: RigCatalog,
  configurations: ReadonlyArray<CriaRigConfiguration>,
  now = () => new Date(),
): Promise<void> {
  for (const configuration of configurations) {
    let rig = await catalog.get(configuration.id)

    if (rig && rig.source?.configurationId !== configuration.id)
      throw new Error(`Cria rig ID ${configuration.id} is already used by another equipment source.`)

    if (!rig) {
      const result = await catalog.add({
        id: configuration.id,
        name: configuration.name,
        endpoint: criaEndpoint(configuration),
        source: { kind: 'cria', configurationId: configuration.id },
        inventory: { observedAt: now().toISOString(), devices: [] },
      })

      if (result.state !== 'added')
        throw new Error(`Cria rig configuration ${configuration.id} conflicts with the catalog.`)
      rig = result.rig
    } else {
      const endpoint = criaEndpoint(configuration)

      if (endpoint.host !== rig.endpoint.host || endpoint.port !== rig.endpoint.port)
        await catalog.observe(endpoint, rig.lastObservedInventory, rig.source)
    }

    const camera = configuration.devices.find(device => device.id === configuration.imagingCameraId)

    if (!rig.imagingCamera && camera) {
      await catalog.setImagingCamera(rig.id, {
        uniqueId: criaDeviceId(configuration, camera.id),
        name: camera.expectedName,
      })
    }

    if (rig.focalLengthMm === undefined && configuration.focalLengthMm !== undefined)
      await catalog.setFocalLength(rig.id, configuration.focalLengthMm)
  }
}
