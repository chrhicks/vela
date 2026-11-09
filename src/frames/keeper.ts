import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { KeptFrame } from './entry.ts'
import { nightOf, type NightNaming } from './night.ts'
import { quote, type Ssh } from './ssh.ts'

export interface KeeperSettings {
  readonly spoolDir: string
  readonly keepDir: string
  readonly naming: NightNaming
  readonly copyAttempts: number
  readonly copyRetryMs: number
}

export interface Sidecar {
  readonly run: string | null
  readonly sequence: string | null
  readonly frame: number | null
  readonly original: string
  readonly sha256: string
  readonly bytes: number
  readonly keptAt: string
}

interface Spooled {
  readonly name: string
  readonly bytes: number
  readonly modifiedAt: number
}

export interface Left {
  readonly what: string
  readonly reason: string
  readonly at: number
}

export interface KeeperOptions {
  readonly ssh: Ssh
  readonly settings: KeeperSettings
  readonly labelOf: (file: string) => { readonly run: string; readonly sequence: string; readonly frame: number } | undefined
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly onKept: (frame: KeptFrame) => void
  readonly onProblem: (message: string) => void
  readonly onLeft: (left: Left) => void
}

export const frameNamePattern = /^[A-Za-z0-9._-]+\.fits$/

export const sidecarName = (file: string) => `${file}.json`

export const previewName = (file: string) => `${file}.png`

function parseListing(stdout: string, onProblem: (message: string) => void): ReadonlyArray<Spooled> {
  const files: Spooled[] = []

  for (const line of stdout.split('\n')) {
    if (line === '') continue

    const [name = '', bytes = '', modified = ''] = line.split('\t')

    if (!frameNamePattern.test(name) || !/^\d+$/.test(bytes) || !Number.isFinite(Number(modified))) onProblem(`skipped a spool entry with an unusable name or listing: ${JSON.stringify(line)}`)
    else files.push({ name, bytes: Number(bytes), modifiedAt: Math.round(Number(modified) * 1000) })
  }

  return files.sort((a, b) => a.modifiedAt - b.modifiedAt)
}

async function sha256Of(path: string) {
  const hash = createHash('sha256')

  await pipeline(createReadStream(path), hash)

  return hash.digest('hex')
}

async function readSidecar(path: string): Promise<Sidecar | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Sidecar
  } catch {
    return undefined
  }
}

async function writeAtomically(path: string, content: string) {
  await writeFile(`${path}.part`, content)
  await rename(`${path}.part`, path)
}

const listingKey = ''

export function makeKeeper({ ssh, settings, labelOf, now, sleep, onKept, onProblem, onLeft }: KeeperOptions) {
  const left = new Map<string, Left>()

  function leave(key: string, what: string, reason: string) {
    const entry = { what, reason, at: now() }

    left.set(key, entry)
    onLeft(entry)
  }

  async function copyAndCheck(file: Spooled, directory: string) {
    const remote = `${settings.spoolDir}/${file.name}`
    const target = join(directory, file.name)
    const temporary = `${target}.part`

    await mkdir(directory, { recursive: true })

    const copied = await ssh(`cat -- ${quote(remote)}`, createWriteStream(temporary))

    if (copied.code !== 0) throw new Error(`copy exited ${copied.code}: ${copied.stderr.trim()}`)

    const size = (await stat(temporary)).size

    if (size !== file.bytes) throw new Error(`copy is ${size} bytes, the spool listed ${file.bytes}`)

    const remoteSum = await ssh(`sha256sum -- ${quote(remote)}`)
    const expected = remoteSum.stdout.slice(0, 64)

    if (remoteSum.code !== 0 || !/^[0-9a-f]{64}$/.test(expected)) throw new Error(`hash on the rig computer failed (exit ${remoteSum.code}): ${remoteSum.stderr.trim()}`)

    const sha256 = await sha256Of(temporary)

    if (sha256 !== expected) throw new Error('hash of the copy differs from the hash of the original')

    await rename(temporary, target)

    return { remote, sha256 }
  }

  async function removeOriginal(remote: string) {
    const removed = await ssh(`rm -- ${quote(remote)}`)

    if (removed.code !== 0) onProblem(`kept ${remote} but could not remove it from the rig computer (exit ${removed.code}): ${removed.stderr.trim()}`)
  }

  async function removeIfKept(file: Spooled, kept: Sidecar) {
    const remote = `${settings.spoolDir}/${file.name}`
    const remoteSum = await ssh(`sha256sum -- ${quote(remote)}`)

    if (remoteSum.code !== 0 || remoteSum.stdout.slice(0, 64) !== kept.sha256) {
      onProblem(`${file.name} on the rig computer does not hash to the kept frame of that name: left in place`)

      return
    }

    await removeOriginal(remote)
  }

  async function keep(file: Spooled, night: string) {
    const directory = join(settings.keepDir, night)
    let reason = ''

    for (let attempt = 1; attempt <= settings.copyAttempts; attempt += 1) {
      try {
        const { remote, sha256 } = await copyAndCheck(file, directory)
        const label = labelOf(file.name)
        const sidecar: Sidecar = { run: label?.run ?? null, sequence: label?.sequence ?? null, frame: label?.frame ?? null, original: remote, sha256, bytes: file.bytes, keptAt: new Date(now()).toISOString() }

        await writeAtomically(join(directory, sidecarName(file.name)), JSON.stringify(sidecar, null, 2))
        left.delete(file.name)
        onKept({ file: file.name, night, bytes: file.bytes, sha256 })
        await removeOriginal(remote)

        return
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error)
        onProblem(`copy of ${file.name}, attempt ${attempt} of ${settings.copyAttempts}: ${reason}`)
        if (attempt < settings.copyAttempts) await sleep(settings.copyRetryMs)
      }
    }

    leave(file.name, file.name, reason)
  }

  async function scan() {
    const listing = await ssh(`find ${quote(settings.spoolDir)} -maxdepth 1 -type f -name '*.fits' -printf '%f\\t%s\\t%T@\\n'`)

    if (listing.code !== 0) {
      onProblem(`could not list ${settings.spoolDir} on the rig computer (exit ${listing.code}): ${listing.stderr.trim()}`)
      leave(listingKey, 'the list of frames on the rig computer', `exit ${listing.code}: ${listing.stderr.trim()}`)

      return
    }

    const files = parseListing(listing.stdout, onProblem)

    left.delete(listingKey)
    for (const key of left.keys()) if (!files.some(file => file.name === key)) left.delete(key)

    for (const file of files) {
      const night = nightOf(file.modifiedAt, settings.naming)
      const kept = await readSidecar(join(settings.keepDir, night, sidecarName(file.name)))

      if (kept === undefined) await keep(file, night)
      else if (kept.bytes !== file.bytes) onProblem(`${file.name} on the rig computer is ${file.bytes} bytes but the kept frame of that name is ${kept.bytes}: not copied`)
      else await removeIfKept(file, kept)
    }
  }

  let running: Promise<void> | undefined
  let again = false

  function requestScan() {
    if (running !== undefined) {
      again = true

      return running
    }

    running = (async () => {
      do {
        again = false
        try {
          await scan()
        } catch (error) {
          onProblem(`scan of ${settings.spoolDir} failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      } while (again)
    })().finally(() => {
      running = undefined
    })

    return running
  }

  return { requestScan, left: (): ReadonlyArray<Left> => [...left.values()] }
}
