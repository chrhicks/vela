import { buildApp } from './app.js'
import { openFileRigCatalog } from './rig/catalog.js'
import { resolveRigCatalogPath } from './rig/catalog-path.js'
import { alignmentSettings } from './alignment/routes.js'
import { dirname, resolve } from 'node:path'
import { openFileSavedImageStore } from './saved-images/store.js'

const port = Number(process.env.PORT ?? 3001)
// Device-control APIs are local by default. Set HOST explicitly to expose them.
const host = process.env.HOST ?? '127.0.0.1'
const rigCatalogPath = resolveRigCatalogPath(process.env.VELA_RIG_CATALOG_PATH)

try {
  const rigCatalog = await openFileRigCatalog(rigCatalogPath)
  const alignment = alignmentSettings(process.env)
  const savedImages = await openFileSavedImageStore(process.env.VELA_SAVED_IMAGES_PATH
    ? resolve(process.env.VELA_SAVED_IMAGES_PATH)
    : resolve(dirname(rigCatalogPath), 'saved-images'))
  const app = buildApp({ rigCatalog, savedImages, ...(alignment ? { alignment } : {}) })
  await app.listen({ port, host })
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
