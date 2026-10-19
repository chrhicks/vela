import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { findLeaks, PrivacyCheckError } from './package.ts'
import { Secrets } from './sanitize.ts'
import { buildSession, type SessionRequest } from './session.ts'

export type AcceptRequest = Omit<SessionRequest, 'name' | 'root' | 'secrets'> & {
  /** Where the two throwaway builds go. */
  readonly scratch: string
}

const summary = z.object({
  rows: z.record(z.string(), z.number()),
  links: z.record(z.string(), z.object({ exact: z.number(), inferred: z.number(), ambiguous: z.number(), none: z.number() })),
  inputs: z.array(z.object({ input: z.string(), status: z.enum(['found', 'missing']), effect: z.string().optional() })),
  skipped: z.array(z.unknown()),
})

export interface Acceptance {
  readonly summary: z.infer<typeof summary> | null
  /** Table and column names, rule names and counts: never a value from the data. */
  readonly problems: readonly string[]
  readonly warnings: readonly string[]
}

type Fingerprint = ReadonlyMap<string, { readonly input: string; readonly size: number; readonly sha256: string }>

/**
 * Builds a package from real inputs twice into a throwaway folder and checks what a night's package must satisfy:
 * the builds are byte-identical, nothing the packager learned from the inputs is in the package, and no input changed.
 */
export async function acceptSession(request: AcceptRequest, build: typeof buildSession = buildSession): Promise<Acceptance> {
  const files = await inputFiles(request)
  const before = await fingerprint(files)
  const work = await mkdtemp(join(request.scratch, 'rig-session-accept-'))
  const problems: string[] = []
  const warnings: string[] = []
  let built: z.infer<typeof summary> | null = null

  try {
    const secrets = new Secrets()
    const shared = { ...request, name: 'acceptance' }
    const one = await build({ ...shared, root: join(work, 'one'), secrets })
    const two = await build({ ...shared, root: join(work, 'two') })

    built = summary.parse(JSON.parse(await readFile(join(one, 'session.json'), 'utf8')))
    problems.push(...(await findLeaks(one, secrets)).map(finding => `privacy scan: ${finding}`))

    const different = await differingFiles(one, two)

    if (different.length > 0) problems.push(`the second build differs in ${different.join(', ')}`)
  } catch (error) {
    problems.push(describe(error instanceof Error ? error : new Error()))
  } finally {
    await rm(work, { recursive: true, force: true })
  }

  for (const [path, { input, size, sha256 }] of before) {
    const after = await changed(path, size, sha256)

    if (after === 'appended') warnings.push(`${input} grew while the command ran; its first ${size} bytes are unchanged (another process is writing it)`)
    else if (after === 'changed') problems.push(`${input} changed while the command ran`)
  }

  return { summary: built, problems, warnings }
}

/** A privacy failure names its findings (table.column: rule); any other error is reduced to what cannot quote the data. */
function describe(error: Error): string {
  if (error instanceof PrivacyCheckError) return `privacy scan: ${error.findings.join('; ')} (the build failed closed, nothing was published)`

  const system = z.object({ code: z.string() }).safeParse(error)

  return `the build failed: ${error.name}${system.success ? ` ${system.data.code}` : ''}`
}

/** Every file the packager reads, by the input it belongs to. The recording's `blobs/` and the saved images are never opened. */
async function inputFiles(request: AcceptRequest): Promise<[string, string][]> {
  const single = [
    ['traces', request.tracesFile],
    ['mount-csv', request.mountCsvFile],
    ['frame-records', request.frameRecordsFile],
    ['cria-journal', request.journalFile],
  ] as const

  const files: [string, string][] = single.flatMap(([input, path]) => (path === null ? [] : [[input, path] satisfies [string, string]]))

  if (request.recordingDir !== null) files.push(['indi-recording', join(request.recordingDir, 'manifest.json')], ['indi-recording', join(request.recordingDir, 'traffic.jsonl')])

  if (request.savedImagesDir !== null && existsSync(request.savedImagesDir)) {
    for (const library of await readdir(request.savedImagesDir)) {
      for (const frame of await readdir(join(request.savedImagesDir, library))) files.push(['saved-images', join(request.savedImagesDir, library, frame, 'metadata.json')])
    }
  }

  return files.filter(([, path]) => existsSync(path))
}

async function fingerprint(files: readonly [string, string][]): Promise<Fingerprint> {
  const entries = await Promise.all(files.map(async ([input, path]) => [path, { input, ...(await digest(path)) }] as const))

  return new Map(entries)
}

async function digest(path: string, length?: number): Promise<{ size: number; sha256: string }> {
  const hash = createHash('sha256')
  let size = 0

  if (length !== 0) {
    for await (const chunk of createReadStream(path, length === undefined ? {} : { end: length - 1 })) {
      hash.update(chunk)
      size += chunk.length
    }
  }

  return { size, sha256: hash.digest('hex') }
}

async function changed(path: string, size: number, sha256: string): Promise<'same' | 'appended' | 'changed'> {
  if (!existsSync(path)) return 'changed'

  const { sha256: prefix } = await digest(path, size)

  if (prefix !== sha256) return 'changed'

  const current = (await digest(path)).size

  return current === size ? 'same' : current > size ? 'appended' : 'changed'
}

/** The files that differ between two builds. `session.json` carries the build time, so it is compared without it. */
async function differingFiles(one: string, two: string): Promise<string[]> {
  const names = [...new Set([...(await readdir(one)), ...(await readdir(two))])].sort()
  const different: string[] = []

  for (const name of names) {
    const a = await readFile(join(one, name)).catch(() => null)
    const b = await readFile(join(two, name)).catch(() => null)
    const same = name === 'session.json' ? withoutBuildTime(a) === withoutBuildTime(b) : a !== null && b !== null && a.equals(b)

    if (!same) different.push(name)
  }

  return different
}

function withoutBuildTime(file: Buffer | null): string | null {
  return file === null ? null : JSON.stringify({ ...z.record(z.string(), z.json()).parse(JSON.parse(file.toString('utf8'))), builtAt: null })
}

export function formatAcceptance({ summary: built, problems, warnings }: Acceptance): string {
  const lines: string[] = []

  if (built !== null) {
    const missing = built.inputs.filter(input => input.status === 'missing')

    lines.push(`inputs found: ${built.inputs.filter(input => input.status === 'found').map(input => input.input).join(', ') || 'none'}`)
    lines.push(...missing.map(input => `missing ${input.input}: ${input.effect ?? ''}`))
    lines.push(`unreadable entries listed in session.json: ${built.skipped.length}`, '', 'rows')
    lines.push(...Object.entries(built.rows).map(([table, count]) => `  ${table.padEnd(20)} ${count}`), '', 'links (exact / inferred / ambiguous / none)')
    lines.push(...Object.entries(built.links).map(([link, { exact, inferred, ambiguous, none }]) => `  ${link.padEnd(24)} ${exact} / ${inferred} / ${ambiguous} / ${none}`), '')
  }

  lines.push(...warnings.map(warning => `warning: ${warning}`), ...problems.map(problem => `FAIL: ${problem}`))
  lines.push(problems.length === 0 ? 'PASS: two builds are byte-identical, no learned value is in the package, no input was altered' : `FAIL: ${problems.length} problem(s)`)

  return lines.join('\n')
}
