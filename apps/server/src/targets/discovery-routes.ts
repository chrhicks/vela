import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { TargetCategory, TargetDiscoveryView, TargetFilterChoice, TargetView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { listTargets, type CatalogTarget } from './catalog/index.js'
import { discoverTargets } from './discovery.js'
import type { Site } from './sky.js'

interface DiscoveryBoundary {
  now: () => Date
  siteView: (rig: RigCatalogRecord) => Promise<{ site: Site | null, siteUnavailableReason: string | null }>
  targetView: (target: CatalogTarget, site: Site | null, at: Date) => TargetView
}
const categories = ['all', 'emission', 'reflection-dark', 'galaxy', 'cluster', 'planetary', 'other'] as const
const filters = ['all', 'dual-band', 'broadband', 'uncertain'] as const
const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, '').replace(/^(ngc|ic|m|b)0+(?=\d)/, '$1')
const reasons = {
  'emission-lines': 'Your L-Ultimate isolates Hα and O III emission. Broadband also preserves surrounding stars and other colors.',
  continuum: 'Use broadband, without the L-Ultimate. Its narrow passbands discard much of this object’s starlight.',
  'mixed-or-unknown': 'Start with broadband. This catalog classification does not establish a useful Hα / O III signal.',
}

export function registerTargetDiscovery(app: FastifyInstance, catalog: RigCatalog, boundary: DiscoveryBoundary) {
  type Snapshot = Awaited<ReturnType<typeof createSnapshot>>
  const snapshots = new Map<string, Snapshot>()
  async function createSnapshot(rig: RigCatalogRecord) {
    const location = await boundary.siteView(rig)
    const at = boundary.now()
    return { rigId: rig.id, ...location, at, calculation: discoverTargets({ targets: listTargets(), site: location.site, now: at }) }
  }

  app.get<{ Params: { rigId: string }, Querystring: { snapshot?: string, q?: string, category?: string, filter?: string, offset?: string } }>(
    '/api/web/rigs/:rigId/target-discovery', async (request, reply) => {
      const rig = await catalog.get(request.params.rigId)
      if (!rig) return reply.code(404).send({ error: 'Rig not found' })
      const values = request.query
      if (Object.values(values).some(value => typeof value !== 'string')) return reply.code(400).send({ error: 'Invalid discovery request' })
      const query = (values.q ?? '').trim()
      const category = values.category ?? 'all'
      const filter = values.filter ?? 'all'
      const offset = Number(values.offset ?? 0)
      if (query.length > 100 || !categories.includes(category as typeof categories[number])
        || !filters.includes(filter as typeof filters[number]) || !Number.isInteger(offset) || offset < 0 || offset > 15000
        || values.snapshot !== undefined && !/^[0-9a-f-]{36}$/.test(values.snapshot)) {
        return reply.code(400).send({ error: 'Invalid discovery request' })
      }
      let snapshotId = values.snapshot
      let snapshot = snapshotId ? snapshots.get(snapshotId) : undefined
      if (snapshotId && (!snapshot || snapshot.rigId !== rig.id)) {
        return reply.code(410).send({ error: 'This saved calculation is no longer available. Refresh to calculate from now.' })
      }
      if (!snapshot) {
        snapshot = await createSnapshot(rig)
        snapshotId = randomUUID()
        snapshots.set(snapshotId, snapshot)
        // These are disposable browsing calculations, never durable observing plans.
        while (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value!)
      }
      const key = normalize(query)
      const matches = snapshot.calculation.candidates.filter(candidate => {
        const target = candidate.target
        const matchesQuery = !key || [...target.aliases, target.catalogName, target.commonName ?? '', target.type].some(value => normalize(value).includes(key))
        return matchesQuery && (Boolean(key) || snapshot.calculation.status === 'site-unavailable' || candidate.eligible)
          && (category === 'all' || candidate.category === category) && (filter === 'all' || candidate.filter === filter)
      })
      const pageSize = 12
      const pageOffset = matches.length ? Math.min(offset, Math.floor((matches.length - 1) / pageSize) * pageSize) : 0
      const view: TargetDiscoveryView = {
        rigId: rig.id, rigName: rig.name, snapshotId: snapshotId!, calculatedAt: snapshot.at.toISOString(),
        status: snapshot.calculation.status, night: snapshot.calculation.window,
        site: snapshot.site, siteUnavailableReason: snapshot.siteUnavailableReason,
        query, category: category as TargetCategory | 'all', filter: filter as TargetFilterChoice | 'all',
        offset: pageOffset, pageSize, total: matches.length,
        targets: matches.slice(pageOffset, pageOffset + pageSize).map(candidate => ({
          ...boundary.targetView(candidate.target, snapshot.site, snapshot.at), category: candidate.category,
          filterChoice: candidate.filter, filterReason: reasons[candidate.filterReason], opportunity: candidate.opportunity,
        })),
      }
      return view
    },
  )
}
