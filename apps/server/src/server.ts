import { buildApp } from './app.js'
import { openFileRigCatalog } from './rig/catalog.js'
import { resolveRigCatalogPath } from './rig/catalog-path.js'
import { alignmentSettings } from './alignment/routes.js'
import { access } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { openFileSavedImageStore } from './saved-images/store.js'
import { noFrameRecords, openFrameRecords } from './capture/frame-records.js'
import { noAutofocusRecords, type AutofocusRecords } from './autofocus/routes.js'
import { openJsonlRecords } from './records.js'
import { noCaptureRuns, openFileCaptureRunStore, type CaptureRunStore } from './capture/run-store.js'
import { createSurveyCache } from './targets/survey.js'
import { startTelemetry } from './telemetry.js'
import { loadCriaConfiguration, registerConfiguredCriaRigs } from './equipment/config.js'
import { createEquipmentComposition } from './equipment/composition.js'
import { loadAlertsConfiguration } from './alerts/config.js'
import { createPushoverNotifier } from './alerts/pushover.js'
import { createHorizon } from './targets/horizon.js'

const telemetry = startTelemetry(process.env.VELA_TRACE_PATH)

const frameRecords = process.env.VELA_FRAME_RECORDS_PATH
  ? openFrameRecords(process.env.VELA_FRAME_RECORDS_PATH)
  : noFrameRecords

const autofocusRecords: AutofocusRecords = process.env.VELA_AUTOFOCUS_RECORDS_PATH
  ? openJsonlRecords(process.env.VELA_AUTOFOCUS_RECORDS_PATH, { name: 'autofocus records' })
  : noAutofocusRecords

let app: ReturnType<typeof buildApp> | undefined

let captureRuns: CaptureRunStore = noCaptureRuns

let shutdownTask: Promise<void> | undefined

function shutdown() {
  if (shutdownTask) return shutdownTask
  shutdownTask = (async () => {
    try {
      await app?.close()
    } finally {
      await captureRuns.close()
      await frameRecords.close()
      await autofocusRecords.close()
      await telemetry.shutdown()
    }
  })()

  return shutdownTask
}

const stop = () => {
  void shutdown().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

process.once('SIGINT', stop)

process.once('SIGTERM', stop)

const port = Number(process.env.PORT ?? 3001)

// Device-control APIs are local by default. Set HOST explicitly to expose them.
const host = process.env.HOST ?? '127.0.0.1'

const rigCatalogPath = resolveRigCatalogPath(process.env.VELA_RIG_CATALOG_PATH)

try {
  const rigCatalog = await openFileRigCatalog(rigCatalogPath)
  const alignment = alignmentSettings(process.env)
  const cria = await loadCriaConfiguration(process.env.VELA_CRIA_CONFIG_PATH, process.env)

  await registerConfiguredCriaRigs(rigCatalog, cria)

  const alertsConfiguration = await loadAlertsConfiguration(process.env.VELA_ALERTS_CONFIG_PATH)

  const phoneSwitchPath = resolve(dirname(rigCatalogPath), 'phone-alerts.json')

  if (await access(phoneSwitchPath).then(() => true, () => false))
    console.warn(`Ignoring ${phoneSwitchPath}: the phone is paged only for a run started or switched to Unattended. Delete the file.`)

  const alerts = {
    thresholds: alertsConfiguration.thresholds,
    notifier: alertsConfiguration.pushover
      ? createPushoverNotifier({ ...alertsConfiguration.pushover, fetch })
      : null,
  }

  captureRuns = await openFileCaptureRunStore(resolve(dirname(rigCatalogPath), 'capture-runs.json'))

  const savedImages = await openFileSavedImageStore(
    process.env.VELA_SAVED_IMAGES_PATH
      ? resolve(process.env.VELA_SAVED_IMAGES_PATH)
      : resolve(dirname(rigCatalogPath), 'saved-images'),
  )

  const horizon = createHorizon(dirname(rigCatalogPath))

  const targets =
    process.env.VELA_ASTAP && process.env.VELA_STAR_CATALOG
      ? {
          horizon,
          solver: {
            executable: process.env.VELA_ASTAP,
            catalogPath: process.env.VELA_STAR_CATALOG,
          },
        }
      : { horizon }

  const surveyCache = createSurveyCache(
    process.env.VELA_SURVEY_CACHE_PATH
      ? { directory: resolve(process.env.VELA_SURVEY_CACHE_PATH) }
      : {},
  )

  const equipmentOptions: NonNullable<Parameters<typeof createEquipmentComposition>[1]> = {}

  if (process.env.VELA_CRIA_JOURNAL_PATH)
    equipmentOptions.criaJournalPath = resolve(process.env.VELA_CRIA_JOURNAL_PATH)

  if (targets.solver) equipmentOptions.solver = targets.solver

  if (process.env.VELA_ALIGNMENT_DIAGNOSTICS_PATH) {
    if (!isAbsolute(process.env.VELA_ALIGNMENT_DIAGNOSTICS_PATH))
      throw new Error('VELA_ALIGNMENT_DIAGNOSTICS_PATH must be an absolute directory path')
    equipmentOptions.diagnosticsPath = process.env.VELA_ALIGNMENT_DIAGNOSTICS_PATH
  }

  const equipment = createEquipmentComposition(cria, equipmentOptions)

  if (!shutdownTask) {
    const options = { rigCatalog, savedImages, frameRecords, autofocusRecords, captureRuns, targets, surveyCache, equipment, alerts }
    app = buildApp(alignment ? { ...options, alignment } : options)
    await app.listen({ port, host })
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
  await shutdown()
}
