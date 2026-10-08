import {
  createAlpacaAcquisition,
  createAlpacaCameraCooling,
  createAlpacaFocuser,
  createAlpacaFraming,
  createAlpacaMountControl,
} from '@vela/alpaca'
import { CriaClient } from '@vela/cria'
import { EquipmentError, type Acquisition, type CameraCooling, type Focuser, type Framing, type MountControl } from '@vela/equipment'
import { createCriaEquipment } from '../cria/equipment.js'
import { createCriaCustody, type CriaCustodyCoordinator } from '../cria/custody.js'
import type { AcquisitionArchive } from '../acquisitions/archive.js'
import { createRigDeviceInventory, type RigDeviceInventory } from '../device/inventory.js'
import { createRigDeviceInspector, type RigDeviceInspector } from '../device/inspection.js'
import { createRigDeviceConnector, type RigDeviceConnector } from '../device/connection.js'
import type { RigCatalogRecord, RigEquipmentSource } from '../rig/contracts.js'
import type { AlignmentSettings } from '../alignment/controller.js'
import { criaDeviceId, type CriaRigConfiguration } from './config.js'
import { alpacaEndpoint } from './source.js'

export interface EquipmentComposition {
  start(): void
  close(): Promise<void>
  createInventory(rig: RigEquipmentSource): RigDeviceInventory
  createInspector(rig: RigEquipmentSource): RigDeviceInspector
  createConnector(rig: RigEquipmentSource): RigDeviceConnector
  createAcquisition(rig: RigCatalogRecord): Acquisition
  createFraming(rig: RigCatalogRecord): Framing
  createFocuser(rig: RigCatalogRecord): Focuser
  createMountControl(rig: RigCatalogRecord): MountControl
  createCooling(rig: RigCatalogRecord): CameraCooling
  alignmentSettings(rig: RigCatalogRecord): AlignmentSettings | undefined
}

interface CompositionOptions {
  solver?: { executable: string; catalogPath: string }
  diagnosticsPath?: string
  /** Required with Cria rigs: every acquired original is preserved here before release. */
  acquisitions?: AcquisitionArchive
  /** How often to finish interrupted archive work; an engineering cadence, not a retention policy. */
  custodyRecoveryMs?: number
}

/** Select equipment ownership at composition; workflows receive only the capabilities they use. */
export function createEquipmentComposition(
  configurations: ReadonlyArray<CriaRigConfiguration> = [],
  options: CompositionOptions = {},
): EquipmentComposition {
  const clients = new Map<string, CriaClient>()
  const custodies = new Map<string, CriaCustodyCoordinator>()
  const equipment = new Map<string, ReturnType<typeof createCriaEquipment>>()
  let recoveryTimer: NodeJS.Timeout | undefined

  if (configurations.length > 0 && !options.acquisitions)
    throw new Error('Cria rigs require an acquisition archive before any capture')

  for (const configuration of configurations) {
    let client = clients.get(configuration.url)

    if (!client) {
      const devices = new Map(configuration.devices.map(device => [device.id, device]))

      for (const other of configurations) {
        if (other.url !== configuration.url) continue

        for (const device of other.devices) devices.set(device.id, device)
      }

      client = new CriaClient({
        baseUrl: configuration.url,
        token: configuration.token,
        storeId: configuration.storeId,
        devices: [...devices.values()],
      })
      clients.set(configuration.url, client)
      custodies.set(configuration.url, createCriaCustody(client, options.acquisitions!, configuration.storeId))
    }

    equipment.set(configuration.id, createCriaEquipment(client, configuration.devices.map(device => ({
      ...device,
      providerDeviceId: criaDeviceId(configuration, device.id),
    })), custodies.get(configuration.url)!, configuration.id))
  }

  function cria(rig: RigEquipmentSource) {
    const configured = rig.source && equipment.get(rig.source.configurationId)

    if (!configured) {
      throw new EquipmentError('The configured Cria equipment connection is unavailable.', {
        reason: 'invalid-response',
        endpoint: 'equipment-configuration',
      })
    }

    return configured
  }

  return {
    start() {
      for (const client of clients.values()) client.start()

      if (custodies.size === 0) return

      const recover = () => {
        for (const custody of custodies.values()) {
          void custody.recover().then(report => {
            if (report.problems.length > 0) console.warn('Acquisition custody recovery incomplete', report)
          }, error => console.warn('Acquisition custody recovery deferred', error))
        }
      }

      recover()
      recoveryTimer = setInterval(recover, options.custodyRecoveryMs ?? 30_000)
      recoveryTimer.unref()
    },
    async close() {
      clearInterval(recoveryTimer)
      await Promise.all([...clients.values()].map(client => client.close()))
    },
    createInventory: rig => rig.source
      ? createRigDeviceInventory(rig, { provider: cria(rig).provider })
      : createRigDeviceInventory(rig),
    createInspector: rig => rig.source
      ? createRigDeviceInspector(rig, { provider: cria(rig).provider })
      : createRigDeviceInspector(rig),
    createConnector: rig => rig.source
      ? createRigDeviceConnector(rig, { provider: cria(rig).provider })
      : createRigDeviceConnector(rig),
    createAcquisition: rig => rig.source
      ? cria(rig).acquisition
      : createAlpacaAcquisition({ baseUrl: alpacaEndpoint(rig) }),
    createFraming: rig => rig.source
      ? cria(rig).framing
      : createAlpacaFraming({ baseUrl: alpacaEndpoint(rig) }),
    createFocuser: rig => rig.source
      ? cria(rig).focuser
      : createAlpacaFocuser({ baseUrl: alpacaEndpoint(rig) }),
    createMountControl: rig => rig.source
      ? cria(rig).mountControl
      : createAlpacaMountControl({ baseUrl: alpacaEndpoint(rig) }),
    createCooling: rig => rig.source
      ? cria(rig).cooling
      : createAlpacaCameraCooling({ baseUrl: alpacaEndpoint(rig) }),
    alignmentSettings(rig) {
      const configuration = configurations.find(item => item.id === rig.source?.configurationId)

      if (!configuration?.alignment || !options.solver) return undefined
      const alignment = configuration.alignment

      let settings: AlignmentSettings = {
        rigId: rig.id,
        mode: alignment.mode,
        endpoint: configuration.url,
        cameraId: criaDeviceId(configuration, alignment.cameraId),
        telescopeId: criaDeviceId(configuration, alignment.telescopeId),
        executable: options.solver.executable,
        catalogPath: options.solver.catalogPath,
        exposureSeconds: alignment.exposureSeconds ?? 2,
        fieldHeightDegrees: 3,
      }

      if (options.diagnosticsPath) settings = { ...settings, diagnosticsPath: options.diagnosticsPath }

      return settings
    },
  }
}
