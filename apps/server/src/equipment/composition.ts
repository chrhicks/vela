import {
  createAlpacaAcquisition,
  createAlpacaCameraCooling,
  createAlpacaDiscovery,
  createAlpacaFocuser,
  createAlpacaFraming,
  createAlpacaMountControl,
  createAlpacaProvider,
  type AlpacaDiscovery,
} from '@vela/alpaca'
import type { AcceptedFix, MountEnvelope } from '@vela/cria'
import type { RigCatalog } from '../rig/catalog.js'
import type { Horizon } from '../targets/horizon.js'
import { defaultThresholds, type AlertThresholds } from '../alerts/thresholds.js'
import { mountEnvelope, stubEnvelope } from './envelope.js'
import { createCriaConnection, createCriaEquipment, type CriaConnection, type CriaConnectionOptions, type CriaRecovery, type JournalSink } from '@vela/cria'
import { criaEvent, rigId, sourceId } from '@vela/rig-events'
import {
  EquipmentError,
  type Acquisition,
  type CameraCooling,
  type EquipmentConnector,
  type EquipmentInspector,
  type EquipmentProvider,
  type Focuser,
  type Framing,
  type MountControl,
  type SwitchControl,
} from '@vela/equipment'
import { createRigDeviceInventory, type RigDeviceInventory } from '../device/inventory.js'
import type { RigCatalogRecord, RigEquipmentSource } from '../rig/contracts.js'
import type { AlignmentSettings } from '../alignment/controller.js'
import { criaDeviceId, type CriaRigConfiguration } from './config.js'
import type { RunLog } from '../run-log/run-log.js'
import { alpacaEndpoint } from './source.js'

export type { MountEnvelope, AcceptedFix } from '@vela/cria'

export interface EquipmentComposition {
  envelopeFor(rigId: string): MountEnvelope
  sendFix(rig: RigCatalogRecord, fix: AcceptedFix): Promise<void>
  holdsOf(rigId: string): ReadonlyArray<{ readonly deviceId: string; readonly reason: string }>
  recover(rig: RigCatalogRecord, deviceId: string, note: string): Promise<CriaRecovery>
  /** Drops a device's uncertain-ending warning. It never touches a hold. */
  dismissWarning(rig: RigCatalogRecord, deviceId: string): void
  start(): void
  close(): Promise<void>
  readonly alpacaDiscovery: AlpacaDiscovery
  createInventory(rig: RigEquipmentSource): RigDeviceInventory
  createInspector(rig: RigEquipmentSource): EquipmentInspector
  createConnector(rig: RigEquipmentSource): EquipmentConnector
  createAcquisition(rig: RigCatalogRecord): Acquisition
  createAlignmentEndpointAcquisition(endpoint: string): Acquisition
  createFraming(rig: RigCatalogRecord): Framing
  createFocuser(rig: RigCatalogRecord): Focuser
  createMountControl(rig: RigCatalogRecord): MountControl
  /** Only a Cria rig has a switch Vela commands; an Alpaca rig has none. */
  createSwitchControl(rig: RigCatalogRecord): SwitchControl | undefined
  createCooling(rig: RigCatalogRecord): CameraCooling
  alignmentSettings(rig: RigCatalogRecord): AlignmentSettings | undefined
}

interface CompositionOptions {
  catalog?: RigCatalog
  horizon?: Pick<Horizon, 'skyline'>
  thresholds?: AlertThresholds
  onFeedbackError?: (message: string) => void
  solver?: { executable: string; catalogPath: string }
  diagnosticsPath?: string
  fetch?: typeof globalThis.fetch
  /** Where each Cria connection reports what it decodes; nothing is kept when absent. */
  runLog?: Pick<RunLog, 'append'>
}

const criaSource = sourceId('vela:cria')

function criaRigId(id: string) {
  try {
    return rigId(id)
  } catch {
    throw new Error(`Cria rig id "${id}" cannot name a rig in the run log: use lowercase letters, digits and hyphens.`)
  }
}

/** The sink one Cria connection reports to: each entry becomes an envelope for this rig. */
function criaSink(log: Pick<RunLog, 'append'>, rig: ReturnType<typeof rigId>): JournalSink {
  return { record: entry => log.append(criaEvent(entry, { rig, source: criaSource })) }
}

/** Select equipment ownership at composition; workflows receive only the capabilities they use. */
export function createEquipmentComposition(
  configurations: ReadonlyArray<CriaRigConfiguration> = [],
  options: CompositionOptions = {},
): EquipmentComposition {
  const envelopes = new Map<string, MountEnvelope>()
  const thresholds = options.thresholds ?? defaultThresholds
  const envelopeFor = (rigId: string) => envelopes.get(rigId) ?? mountEnvelope(configurations.find(config => config.id === rigId)?.envelope ?? stubEnvelope, thresholds, null)
  const clients = new Map<string, CriaConnection>()
  const equipment = new Map<string, ReturnType<typeof createCriaEquipment>>()

  for (const configuration of configurations) {
    let client = clients.get(configuration.url)

    if (!client) {
      let connection: CriaConnectionOptions = { origin: configuration.url }

      if (configuration.token) connection = { ...connection, token: configuration.token }

      if (options.fetch) connection = { ...connection, fetch: options.fetch }

      if (options.runLog) connection = { ...connection, journal: criaSink(options.runLog, criaRigId(configuration.id)) }

      connection = {
        ...connection,
        onFeedbackError: options.onFeedbackError ?? (message => console.warn(message)),
        async envelopes() {
          const outgoing: Array<{ deviceId: string; envelope: MountEnvelope }> = []

          for (const configured of configurations.filter(rig => rig.url === configuration.url)) {
            const rig = await options.catalog?.get(configured.id)

            if (options.catalog && rig?.source?.configurationId !== configured.id) continue
            const skyline = await options.horizon?.skyline(configured.id) ?? null
            const envelope = mountEnvelope(configured.envelope ?? stubEnvelope, thresholds, skyline)
            envelopes.set(configured.id, envelope)

            for (const device of configured.devices.filter(device => device.kind === 'mount')) outgoing.push({ deviceId: device.id, envelope })
          }

          return outgoing
        },
      }
      client = createCriaConnection(connection)
      clients.set(configuration.url, client)
    }

    equipment.set(configuration.id, createCriaEquipment(client, configuration.devices.map(device => ({
      ...device,
      providerDeviceId: criaDeviceId(configuration, device.id),
    }))))
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

  function provider(rig: RigEquipmentSource): EquipmentProvider {
    return rig.source ? cria(rig).provider : createAlpacaProvider({ baseUrl: alpacaEndpoint(rig) })
  }

  return {
    envelopeFor,
    async sendFix(rig, fix) {
      const configuration = configurations.find(item => item.id === rig.source?.configurationId)

      if (!configuration) return
      const client = clients.get(configuration.url)!

      for (const mount of configuration.devices.filter(device => device.kind === 'mount')) {
        try {
          await client.sendFix(mount.id, fix)
        } catch (error) {
          const report = options.onFeedbackError ?? (message => console.warn(message))
          report(String(error))
        }
      }
    },
    holdsOf: rigId => equipment.get(rigId)?.holds() ?? [],
    recover: (rig, deviceId, note) => rig.source
      ? cria(rig).recover(deviceId, note)
      : Promise.resolve({ outcome: 'failed', busy: false, message: 'This rig has no Cria recovery.' }),
    dismissWarning: (rig, deviceId) => {
      if (rig.source) cria(rig).dismissWarning(deviceId)
    },
    start() {
      for (const client of clients.values()) client.start()
    },
    async close() {
      await Promise.all([...clients.values()].map(client => client.close()))
    },
    alpacaDiscovery: createAlpacaDiscovery(),
    createInventory: rig => createRigDeviceInventory(rig, { provider: provider(rig) }),
    createInspector: provider,
    createConnector: provider,
    createAcquisition: rig => rig.source
      ? cria(rig).acquisition
      : createAlpacaAcquisition({ baseUrl: alpacaEndpoint(rig) }),
    createAlignmentEndpointAcquisition: endpoint => createAlpacaAcquisition({ baseUrl: endpoint }),
    createFraming: rig => rig.source
      ? cria(rig).framing
      : createAlpacaFraming({ baseUrl: alpacaEndpoint(rig) }),
    createFocuser: rig => rig.source
      ? cria(rig).focuser
      : createAlpacaFocuser({ baseUrl: alpacaEndpoint(rig) }),
    createMountControl: rig => rig.source
      ? cria(rig).mountControl
      : createAlpacaMountControl({ baseUrl: alpacaEndpoint(rig) }),
    createSwitchControl: rig => rig.source ? cria(rig).switchControl : undefined,
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

      if (alignment.sweepRateDegreesPerSecond !== undefined)
        settings = { ...settings, sweepRateDegreesPerSecond: alignment.sweepRateDegreesPerSecond }

      if (alignment.maxLegSeconds !== undefined) settings = { ...settings, maxLegSeconds: alignment.maxLegSeconds }

      return settings
    },
  }
}
