import { buildApp } from './app.js'
import { openFileRigCatalog } from './rig/catalog.js'
import { resolveRigCatalogPath } from './rig/catalog-path.js'

const port = Number(process.env.PORT ?? 3001)
// Device-control APIs are local by default. Set HOST explicitly to expose them.
const host = process.env.HOST ?? '127.0.0.1'
const rigCatalogPath = resolveRigCatalogPath(process.env.VELA_RIG_CATALOG_PATH)

try {
  const rigCatalog = await openFileRigCatalog(rigCatalogPath)
  const app = buildApp({ rigCatalog })
  await app.listen({ port, host })
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
