import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { TargetCatalogView, TargetDiscoveryView, TargetView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { listTargets, normalizeCatalogName, type CatalogTarget } from './catalog/index.js'
import { discoverTargets } from './discovery.js'
import type { Site } from './sky.js'

interface DiscoveryBoundary {
  now: () => Date
  siteView: (
    rig: RigCatalogRecord,
  ) => Promise<{ site: Site | null; siteUnavailableReason: string | null }>
  targetView: (target: CatalogTarget, site: Site | null, at: Date) => TargetView
}

const categories = [
  'all',
  'emission',
  'reflection-dark',
  'galaxy',
  'cluster',
  'planetary',
  'other',
] as const

const filters = ['all', 'dual-band', 'broadband', 'uncertain'] as const

const reasons = {
  'emission-lines':
    'Your L-Ultimate isolates Hα and O III emission. Broadband also preserves surrounding stars and other colors.',
  continuum:
    'Use broadband, without the L-Ultimate. Its narrow passbands discard much of this object’s starlight.',
  'mixed-or-unknown':
    'Start with broadband. This catalog classification does not establish a useful Hα / O III signal.',
}

export function registerTargetDiscovery(
  app: FastifyInstance,
  catalog: RigCatalog,
  boundary: DiscoveryBoundary,
) {
  type Snapshot = Awaited<ReturnType<typeof createSnapshot>>

  const snapshots = new Map<string, Snapshot>()

  async function createSnapshot(rig: RigCatalogRecord) {
    const location = await boundary.siteView(rig)
    const at = boundary.now()

    return {
      rigId: rig.id,
      ...location,
      at,
      calculation: discoverTargets({ targets: listTargets(), site: location.site, now: at }),
    }
  }

  app.get('/api/web/target-catalog', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query)

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid catalog request' })
    const { q: query, category, filter } = parsed.data
    const calculation = discoverTargets({ targets: listTargets(), site: null, now: boundary.now() })

    const page = catalogPage(calculation, parsed.data, target =>
      boundary.targetView(target, null, boundary.now()),
    )

    const view: TargetCatalogView = {
      query,
      category,
      filter,
      ...page,
      targets: page.targets.map(({ sky: _sky, opportunity: _opportunity, ...target }) => target),
    }

    return view
  })

  app.get<{
    Params: { rigId: string }
    Querystring: {
      snapshot?: string
      q?: string
      category?: string
      filter?: string
      offset?: string
      pageSize?: string
    }
  }>('/api/web/rigs/:rigId/target-discovery', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'Rig not found' })

    const parsed = querySchema
      .extend({ snapshot: z.string().regex(/^[0-9a-f-]{36}$/).optional() })
      .safeParse(request.query)

    if (!parsed.success) return reply.code(400).send({ error: 'Invalid discovery request' })
    const values = parsed.data
    const { q: query, category, filter } = values

    let snapshotId = values.snapshot
    let snapshot = snapshotId ? snapshots.get(snapshotId) : undefined

    if (snapshotId && (!snapshot || snapshot.rigId !== rig.id)) {
      return reply.code(410).send({
        error: 'This saved calculation is no longer available. Refresh to calculate from now.',
      })
    }

    if (!snapshot) {
      snapshot = await createSnapshot(rig)
      snapshotId = randomUUID()
      snapshots.set(snapshotId, snapshot)

      // These are disposable browsing calculations, never durable observing plans.
      while (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value!)
    }

    const page = catalogPage(snapshot.calculation, values, target =>
      boundary.targetView(target, snapshot.site, snapshot.at),
    )

    const view: TargetDiscoveryView = {
      rigId: rig.id,
      rigName: rig.name,
      snapshotId: snapshotId!,
      calculatedAt: snapshot.at.toISOString(),
      status: snapshot.calculation.status,
      night: snapshot.calculation.window,
      site: snapshot.site,
      siteUnavailableReason: snapshot.siteUnavailableReason,
      query,
      category,
      filter,
      ...page,
    }

    return view
  })
}

const querySchema = z.object({
  q: z.string().trim().max(100).default(''),
  category: z.enum(categories).default('all'),
  filter: z.enum(filters).default('all'),
  offset: z.string().default('0').transform(Number).pipe(z.number().int().min(0).max(15000)),
  pageSize: z.string().default('12').transform(Number).pipe(z.number().int().min(1).max(12)),
}).catchall(z.string())

function catalogPage(
  calculation: ReturnType<typeof discoverTargets>,
  { q: query, category, filter, offset, pageSize }: z.infer<typeof querySchema>,
  targetView: (target: CatalogTarget) => TargetView,
) {
  const key = normalizeCatalogName(query)

  const matches = calculation.candidates.filter(candidate => {
    const target = candidate.target

    const matchesQuery = !key ||
      [...target.aliases, target.catalogName, target.commonName ?? '', target.type].some(value =>
        normalizeCatalogName(value).includes(key),
      )

    return (
      matchesQuery &&
      (Boolean(key) || calculation.status === 'site-unavailable' || candidate.eligible) &&
      (category === 'all' || candidate.category === category) &&
      (filter === 'all' || candidate.filter === filter)
    )
  })

  const pageOffset = matches.length
    ? Math.min(offset, Math.floor((matches.length - 1) / pageSize) * pageSize)
    : 0

  return {
    offset: pageOffset,
    pageSize,
    total: matches.length,
    targets: matches.slice(pageOffset, pageOffset + pageSize).map(candidate => ({
      ...targetView(candidate.target),
      category: candidate.category,
      filterChoice: candidate.filter,
      filterReason: reasons[candidate.filterReason],
      opportunity: candidate.opportunity,
    })),
  }
}
