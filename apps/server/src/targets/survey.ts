import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'

const ROOT = 'https://alasky.cds.unistra.fr/DSS/DSSColor/'

const CUTOUT = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits'

// Bump the namespace when source or rendering parameters change. Upstream tiles
// are a survey snapshot, not live rig imagery. Properties retain full attribution.
const VERSION = 'dss2-color-2019-05-07-v1'

export const SURVEY_ATTRIBUTION = {
  name: 'DSS2 color',
  credit: 'Digitized Sky Survey — STScI/NASA; colored and HEALPix mapped by CDS',
  source: ROOT,
  copyrightUrl: 'https://archive.stsci.edu/dss/copyright.html',
  hipsLicense: 'ODbL-1.0',
  cutoutCredit: 'Thumbnails use hips2fits, a service provided by CDS.',
} as const

export interface SurveyImage {
  body: Buffer
  contentType: 'image/jpeg' | 'text/plain'
  attribution: typeof SURVEY_ATTRIBUTION
}

export interface SurveyThumbnail {
  raDegrees: number
  decDegrees: number
  fovDegrees?: number
  majorAxisArcminutes?: number | null
}

export interface SurveyCacheOptions {
  directory?: string
  fetch?: typeof globalThis.fetch
  maxBytes?: number
}

function validatePath(path: string): void {
  if (path === 'properties' || path === 'Norder3/Allsky.jpg') return
  const match = /^Norder([0-9])\/Dir(0|[1-9]\d*)\/Npix(0|[1-9]\d*)\.jpg$/.exec(path)

  if (!match) throw new RangeError('Invalid DSS2 tile path')
  const order = Number(match[1])
  const directory = Number(match[2])
  const pixel = Number(match[3])

  if (!Number.isSafeInteger(pixel) || pixel >= 12 * 4 ** order
    || directory !== Math.floor(pixel / 10000) * 10000) {
    throw new RangeError('Invalid DSS2 HEALPix tile')
  }
}

function thumbnailUrl(target: SurveyThumbnail): string {
  const { raDegrees, decDegrees, majorAxisArcminutes } = target
  const extent = majorAxisArcminutes ?? 30
  const fov = target.fovDegrees ?? Math.min(5, Math.max(0.5, extent / 60 * 1.5))

  if (!Number.isFinite(raDegrees) || raDegrees < 0 || raDegrees >= 360
    || !Number.isFinite(decDegrees) || Math.abs(decDegrees) > 90
    || !Number.isFinite(fov) || fov < 0.5 || fov > 5
    || !Number.isFinite(extent) || extent <= 0) {
    throw new RangeError('Invalid survey thumbnail coordinates or field of view')
  }

  const url = new URL(CUTOUT)
  url.search = new URLSearchParams({
    hips: 'CDS/P/DSS2/color',
    width: '400',
    height: '300',
    projection: 'TAN',
    coordsys: 'icrs',
    ra: String(raDegrees),
    dec: String(decDegrees),
    fov: String(fov),
    rotation_angle: '0',
    format: 'jpg',
  }).toString()

  return url.href
}

function validateBody(body: Buffer, contentType: SurveyImage['contentType']): void {
  if (contentType === 'image/jpeg') {
    if (body.length < 4 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff
      || body[body.length - 2] !== 0xff || body[body.length - 1] !== 0xd9) {
      throw new Error('DSS2 returned an invalid JPEG')
    }
  } else if (!/^creator_did\s*=\s*ivo:\/\/CDS\/P\/DSS2\/color\s*$/m.test(body.toString())
    || !/^obs_copyright\s*=/m.test(body.toString())) {
    throw new Error('DSS2 returned invalid survey properties')
  }
}

function missing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function createSurveyCache(options: SurveyCacheOptions = {}) {
  const directory = options.directory ?? join(homedir(), '.cache', 'vela', 'survey', VERSION)
  const fetchImage = options.fetch ?? globalThis.fetch
  const maxBytes = options.maxBytes ?? 256 * 1024 * 1024

  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) {
    throw new RangeError('Survey cache size must be at least 1024 bytes')
  }

  const bodyLimit = Math.min(16 * 1024 * 1024, maxBytes - 512)
  const entries = new Map<string, { bytes: number, used: number }>()
  const pending = new Map<string, Promise<SurveyImage>>()
  let totalBytes = 0
  // Disk bookkeeping is serialized; network reads remain independent.
  let diskQueue = Promise.resolve()

  function onDisk<T>(operation: () => Promise<T>): Promise<T> {
    const result = diskQueue.then(operation)
    diskQueue = result.then(() => {}, () => {})

    return result
  }

  async function remove(name: string) {
    await unlink(join(directory, name)).catch(error => {
      if (!missing(error)) throw error
    })
    totalBytes -= entries.get(name)?.bytes ?? 0
    entries.delete(name)
  }

  async function evict(incoming = 0) {
    for (const [name] of [...entries].sort((a, b) => a[1].used - b[1].used || a[0].localeCompare(b[0]))) {
      if (totalBytes + incoming <= maxBytes) break
      await remove(name)
    }
  }

  const ready = onDisk(async () => {
    await mkdir(directory, { recursive: true })

    for (const name of await readdir(directory)) {
      if (/^[a-f0-9]{64}\.cache\.[a-f0-9-]{36}\.tmp$/.test(name)) {
        await unlink(join(directory, name))
        continue
      }

      if (!/^[a-f0-9]{64}\.cache$/.test(name)) continue
      const info = await stat(join(directory, name))

      if (!info.isFile()) continue
      entries.set(name, { bytes: info.size, used: info.mtimeMs })
      totalBytes += info.size
    }

    await evict()
  })

  // A storage error is surfaced by requests, without an unhandled rejection
  // merely because the cache was composed before its first use.
  void ready.catch(() => {})

  async function load(url: string, contentType: SurveyImage['contentType']): Promise<SurveyImage> {
    await ready
    const key = `${VERSION}\n${url}`
    const name = `${createHash('sha256').update(key).digest('hex')}.cache`

    const cached = await onDisk(async () => {
      if (!entries.has(name)) return undefined

      try {
        const entry = entries.get(name)!

        if (entry.bytes > maxBytes) throw new Error('Oversized cache entry')
        const bytes = await readFile(join(directory, name))
        const newline = bytes.indexOf(10)

        if (newline < 0 || newline > 2048) throw new Error('Invalid cache metadata')
        const metadata = z.object({ key: z.literal(key) }).safeParse(JSON.parse(bytes.subarray(0, newline).toString()))

        if (!metadata.success) throw new Error('Invalid cache key')
        const body = bytes.subarray(newline + 1)
        validateBody(body, contentType)
        const used = Date.now()
        await utimes(join(directory, name), used / 1000, used / 1000)
        entry.used = used

        return { body, contentType, attribution: SURVEY_ATTRIBUTION }
      } catch (error) {
        if (error instanceof Error && 'code' in error && !missing(error)) throw error
        await remove(name)

        return undefined
      }
    })

    if (cached) return cached

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    let body: Buffer

    try {
      const response = await fetchImage(url, { signal: controller.signal, redirect: 'error' })

      if (!response.ok) throw new Error(`DSS2 service returned HTTP ${response.status}`)
      const actualType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()

      if (actualType !== contentType) throw new Error('Unexpected DSS2 content type')
      const length = Number(response.headers.get('content-length') ?? 0)

      if (!Number.isFinite(length) || length < 0 || length > bodyLimit) {
        throw new Error('DSS2 response exceeds the cache item limit')
      }

      if (!response.body) throw new Error('DSS2 returned an empty response')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0

      try {
        while (true) {
          const chunk = await reader.read()

          if (chunk.done) break
          size += chunk.value.byteLength

          if (size > bodyLimit) throw new Error('DSS2 response exceeds the cache item limit')
          chunks.push(chunk.value)
        }
      } finally {
        await reader.cancel()
      }

      body = Buffer.concat(chunks)
      validateBody(body, contentType)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }

    await onDisk(async () => {
      const header = JSON.stringify({ key, attribution: SURVEY_ATTRIBUTION }) + '\n'
      const bytes = Buffer.concat([Buffer.from(header), body])

      if (bytes.length > maxBytes) throw new Error('Survey image exceeds cache capacity')
      await evict(bytes.length)
      const temporary = join(directory, `${name}.${randomUUID()}.tmp`)

      try {
        await writeFile(temporary, bytes, { flag: 'wx' })
        await rename(temporary, join(directory, name))
      } finally {
        await unlink(temporary).catch(error => {
          if (!missing(error)) throw error
        })
      }

      totalBytes -= entries.get(name)?.bytes ?? 0
      entries.set(name, { bytes: bytes.length, used: Date.now() })
      totalBytes += bytes.length
    })

    return { body, contentType, attribution: SURVEY_ATTRIBUTION }
  }

  function request(url: string, contentType: SurveyImage['contentType']) {
    const existing = pending.get(url)

    if (existing) return existing
    const work = load(url, contentType).finally(() => { pending.delete(url) })
    pending.set(url, work)

    return work
  }

  return {
    get(path: string) {
      validatePath(path)

      return request(ROOT + path, path === 'properties' ? 'text/plain' : 'image/jpeg')
    },
    thumbnail(target: SurveyThumbnail) {
      return request(thumbnailUrl(target), 'image/jpeg')
    },
  }
}

export type SurveyCache = ReturnType<typeof createSurveyCache>

export function registerSurvey(app: FastifyInstance, cache: SurveyCache) {
  app.get<{ Params: { '*': string } }>('/api/survey/dss2/*', {
    schema: {
      params: {
        type: 'object',
        required: ['*'],
        properties: { '*': { type: 'string', maxLength: 100 } },
      },
    },
  }, async (request, reply) => {
    if (request.raw.url?.includes('?')) return reply.code(400).send({ error: 'Survey tile queries are unsupported' })

    try {
      const image = await cache.get(request.params['*'])

      return reply.type(image.contentType).header('cache-control', 'public, max-age=86400')
        .header('x-survey-source', SURVEY_ATTRIBUTION.source).send(image.body)
    } catch (error) {
      if (error instanceof RangeError) return reply.code(400).send({ error: error.message })
      request.log.warn(error, 'Survey reference image unavailable')

      return reply.code(503).send({ error: 'Survey reference is unavailable; cached areas remain available.' })
    }
  })
  app.get<{ Querystring: { ra: number, dec: number, fov: number } }>('/api/survey/thumbnail', {
    schema: {
      querystring: {
        type: 'object',
        required: ['ra', 'dec', 'fov'],
        additionalProperties: false,
        properties: {
          ra: { type: 'number', minimum: 0, exclusiveMaximum: 360 },
          dec: { type: 'number', minimum: -90, maximum: 90 },
          fov: { type: 'number', minimum: 0.5, maximum: 5 },
        },
      },
    },
  }, async (request, reply) => {
    const parameters = new URL(request.raw.url!, 'http://localhost').searchParams

    if ([...parameters.keys()].some((key) => !['ra', 'dec', 'fov'].includes(key))
      || ['ra', 'dec', 'fov'].some((key) => parameters.getAll(key).length !== 1 || !parameters.get(key)?.trim())) {
      return reply.code(400).send({ error: 'Invalid thumbnail parameters' })
    }

    try {
      const image = await cache.thumbnail({
        raDegrees: request.query.ra,
        decDegrees: request.query.dec,
        fovDegrees: request.query.fov,
      })

      return reply.type(image.contentType).header('cache-control', 'public, max-age=86400')
        .header('x-survey-source', SURVEY_ATTRIBUTION.source).send(image.body)
    } catch (error) {
      if (error instanceof RangeError) return reply.code(400).send({ error: error.message })
      request.log.warn(error, 'Survey thumbnail unavailable')

      return reply.code(503).send({ error: 'Survey thumbnail is unavailable.' })
    }
  })
}
