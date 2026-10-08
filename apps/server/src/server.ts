import { buildApp } from './app.js'
import { openFileRigCatalog } from './rig/catalog.js'
import { resolveRigCatalogPath } from './rig/catalog-path.js'
import { alignmentSettings } from './alignment/routes.js'
import { dirname, isAbsolute, resolve } from 'node:path'
import { openFileSavedImageStore } from './saved-images/store.js'
import { createSurveyCache } from './targets/survey.js'
import { startTelemetry } from './telemetry.js'
import { loadCriaConfiguration, registerConfiguredCriaRigs } from './equipment/config.js'
import { createEquipmentComposition } from './equipment/composition.js'
import { openAcquisitionArchive } from './acquisitions/archive.js'

const telemetry = startTelemetry(process.env.VELA_TRACE_PATH)

let app: ReturnType<typeof buildApp> | undefined

let shutdownTask: Promise<void> | undefined

function shutdown() {
  if (shutdownTask) return shutdownTask
  shutdownTask = (async () => {
    try {
      await app?.close()
    } finally {
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

  const savedImages = await openFileSavedImageStore(
    process.env.VELA_SAVED_IMAGES_PATH
      ? resolve(process.env.VELA_SAVED_IMAGES_PATH)
      : resolve(dirname(rigCatalogPath), 'saved-images'),
  )

  const targets =
    process.env.VELA_ASTAP && process.env.VELA_STAR_CATALOG
      ? {
          solver: {
            executable: process.env.VELA_ASTAP,
            catalogPath: process.env.VELA_STAR_CATALOG,
          },
        }
      : {}

  const surveyCache = createSurveyCache(
    process.env.VELA_SURVEY_CACHE_PATH
      ? { directory: resolve(process.env.VELA_SURVEY_CACHE_PATH) }
      : {},
  )

  const equipmentOptions: NonNullable<Parameters<typeof createEquipmentComposition>[1]> = {}

  if (targets.solver) equipmentOptions.solver = targets.solver

  if (cria.length > 0) {
    equipmentOptions.acquisitions = await openAcquisitionArchive(
      process.env.VELA_ACQUISITIONS_PATH
        ? resolve(process.env.VELA_ACQUISITIONS_PATH)
        : resolve(dirname(rigCatalogPath), 'acquisitions'),
    )
  }

  if (process.env.VELA_ALIGNMENT_DIAGNOSTICS_PATH) {
    if (!isAbsolute(process.env.VELA_ALIGNMENT_DIAGNOSTICS_PATH))
      throw new Error('VELA_ALIGNMENT_DIAGNOSTICS_PATH must be an absolute directory path')
    equipmentOptions.diagnosticsPath = process.env.VELA_ALIGNMENT_DIAGNOSTICS_PATH
  }

  const equipment = createEquipmentComposition(cria, equipmentOptions)

  if (!shutdownTask) {
    const options = { rigCatalog, savedImages, targets, surveyCache, equipment }
    app = buildApp(alignment ? { ...options, alignment } : options)
    await app.listen({ port, host })
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
  await shutdown()
}
