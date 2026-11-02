import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { canonicalJson, epochMs, seal, sourceId } from '@vela/rig-events'
import { frameRigId } from '../capture/frame-records.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import type { RunLog } from '../run-log/run-log.js'
import { compare, itemOf, itemsForRig, manifestSchema, warningsOf, type Facts, type ItemCheck, type Manifest } from './manifest.js'
import { sha256Directory, sha256File } from './observe.js'

export interface Attestation {
  /** Compares what is installed with the pinned manifest, pins it if nothing is pinned yet, and files one event per rig. Never throws. */
  check(): Promise<void>
  /** Pins what is installed now, replacing the manifest, then checks. */
  pin(): Promise<void>
  /** The warnings of the last check that concern one rig. Empty before the first check finishes. */
  warningsFor(rigId: string): string[]
}

export const noAttestation: Attestation = { check: async () => {}, pin: async () => {}, warningsFor: () => [] }

export interface AttestationOptions {
  /** The manifest file, in Vela's data directory. */
  readonly manifestPath: string
  readonly solver?: { readonly executable: string; readonly catalogPath: string }
  readonly rigs: () => Promise<ReadonlyArray<RigCatalogRecord>>
  /** The address of a rig's Cria, if it has one. */
  readonly criaOrigin: (rig: RigCatalogRecord) => string | undefined
  readonly runLog?: Pick<RunLog, 'append'>
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
}

const attestationSource = sourceId('vela:attestation')

const criaTimeoutMs = 3_000

const health = z.record(z.string(), z.union([z.string(), z.number()]))

async function attempt(read: () => Promise<string>) {
  try {
    return await read()
  } catch {
    return undefined
  }
}

/** What Cria's `/health` says about itself, without its `status`: today the protocol version, and a build id once Cria sends one. */
async function criaIdentity(origin: string, fetchHealth: typeof globalThis.fetch) {
  const reply = await fetchHealth(new URL('/health', origin), { signal: AbortSignal.timeout(criaTimeoutMs) })

  if (!reply.ok) throw new Error(`Cria answered ${reply.status}`)

  const { status: _status, ...identity } = health.parse(await reply.json())

  return canonicalJson(identity)
}

async function readManifest(path: string): Promise<Manifest | undefined | 'unreadable'> {
  try {
    return manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? undefined : 'unreadable'
  }
}

async function writeManifest(path: string, manifest: Manifest) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(`${path}.tmp`, path)
}

export function createAttestation({ manifestPath, solver, rigs, criaOrigin, runLog, fetch = globalThis.fetch, now = Date.now }: AttestationOptions): Attestation {
  let warnings = new Map<string, string[]>()

  async function observe(list: ReadonlyArray<RigCatalogRecord>): Promise<Facts> {
    const facts: Record<string, string | undefined> = {}

    if (solver) {
      facts[itemOf('astap')] = await attempt(() => sha256File(solver.executable))
      facts[itemOf('catalog')] = await attempt(() => sha256Directory(solver.catalogPath))
    }

    for (const rig of list) {
      const origin = criaOrigin(rig)

      if (origin) facts[itemOf('cria', rig.id)] = await attempt(() => criaIdentity(origin, fetch))

      if (rig.focalLengthMm !== undefined)
        facts[itemOf('optics', rig.id)] = `focalLengthMm=${rig.focalLengthMm};camera=${rig.imagingCamera?.name ?? 'none'}`
    }

    return Object.fromEntries(Object.entries(facts).filter((entry): entry is [string, string] => entry[1] !== undefined))
  }

  /** A manifest that cannot be read must not look like a clean check, so every rig warns until it is pinned again. */
  function warnUnreadable(list: ReadonlyArray<RigCatalogRecord>) {
    warnings = new Map(list.map(rig => [rig.id, ['The pinned manifest could not be read. Pin again to replace it.']]))
    console.error('Vela attestation: the pinned manifest could not be read')
  }

  function report(list: ReadonlyArray<RigCatalogRecord>, checks: ReadonlyArray<ItemCheck>, pinnedAt: string) {
    warnings = new Map()

    for (const rig of list) {
      const own = itemsForRig(checks, rig.id)
      const at = epochMs(Math.round(now()))

      warnings.set(rig.id, warningsOf(own, pinnedAt))

      try {
        runLog?.append(seal({ rig: frameRigId(rig.id), source: attestationSource, kind: 'attestation', at, seenAt: at, body: { pinnedAt, items: own } }))
      } catch (error) {
        console.error('Vela attestation:', error instanceof Error ? error.message : String(error))
      }
    }

    for (const line of new Set([...warnings.values()].flat())) console.warn('Vela attestation:', line)
  }

  async function run(repin: boolean) {
    try {
      const list = await rigs()
      const observed = await observe(list)
      const pinned = repin ? undefined : await readManifest(manifestPath)

      if (pinned === 'unreadable') return warnUnreadable(list)

      const manifest = pinned ?? { pinnedAt: new Date(now()).toISOString(), items: observed }

      if (!pinned) await writeManifest(manifestPath, manifest)

      report(list, compare(repin ? manifest : pinned, observed), manifest.pinnedAt)
    } catch (error) {
      console.error('Vela attestation:', error instanceof Error ? error.message : String(error))
    }
  }

  return {
    check: () => run(false),
    pin: () => run(true),
    warningsFor: rigId => warnings.get(rigId) ?? [],
  }
}
