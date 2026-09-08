import { createStarSource } from './catalog.js'
import { buildSimulator } from './service.js'

const catalog = process.env.VELA_STAR_CATALOG
if (!catalog) throw new Error('Set VELA_STAR_CATALOG to a locally provisioned ASTAP D05 directory; see README.md')
const port = 7850
const stars = createStarSource(catalog)
const app = buildSimulator({ stars })
await app.listen({ host: process.env.VELA_SIM_HOST ?? '127.0.0.1', port })
console.log(`Vela rig simulator: ${app.listeningOrigin} (catalog fields loaded on exposure)`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close() })
