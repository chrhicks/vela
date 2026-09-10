import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSurveyCache, registerSurvey } from './survey.js'

const directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function directory() {
  const result = await mkdtemp(join(tmpdir(), 'vela-survey-'))
  directories.push(result)

  return result
}

function jpeg(size = 100) {
  const body = Buffer.alloc(size)
  body.set([0xff, 0xd8, 0xff])
  body.set([0xff, 0xd9], size - 2)

  return body
}

function response(size = 100) {
  return new Response(jpeg(size), { headers: { 'content-type': 'image/jpeg' } })
}

describe('DSS2 persistent survey cache', () => {
  it('deduplicates an in-flight miss and serves the exact bytes offline after restart', async () => {
    const location = await directory()
    let release!: (value: Response) => void
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise((resolve) => { release = resolve }))
    const cache = createSurveyCache({ directory: location, fetch })
    const first = cache.get('Norder3/Dir0/Npix2.jpg')
    const second = cache.get('Norder3/Dir0/Npix2.jpg')
    expect(first).toBe(second)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    release(response())
    expect((await first).body).toEqual(jpeg())
    expect((await cache.get('Norder3/Dir0/Npix2.jpg')).body).toEqual(jpeg())
    expect(fetch).toHaveBeenCalledTimes(1)
    const offline = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('offline'))
    const restarted = createSurveyCache({ directory: location, fetch: offline })
    expect((await restarted.get('Norder3/Dir0/Npix2.jpg')).body).toEqual(jpeg())
    expect(offline).not.toHaveBeenCalled()
  })

  it('validates paths and HEALPix ranges before fetching', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response())
    const cache = createSurveyCache({ directory: await directory(), fetch })

    for (const path of ['../secret', 'properties?url=https://example.org', 'Norder10/Dir0/Npix0.jpg',
      'Norder0/Dir0/Npix12.jpg', 'Norder9/Dir0/Npix10000.jpg', 'Norder3/Allsky.png',
      'Norder9/Dir0/Npix01.jpg', 'https://example.org/image.jpg']) {
      expect(() => cache.get(path), path).toThrow(RangeError)
    }

    expect(fetch).not.toHaveBeenCalled()
    await cache.get('Norder9/Dir3140000/Npix3145727.jpg')
    expect(fetch.mock.calls[0]?.[0]).toBe('https://alasky.cds.unistra.fr/DSS/DSSColor/Norder9/Dir3140000/Npix3145727.jpg')
  })

  it('preserves survey properties and their full copyright text', async () => {
    const text = 'creator_did = ivo://CDS/P/DSS2/color\nobs_copyright = Original attribution\n'

    const cache = createSurveyCache({ directory: await directory(),
      fetch: async () => new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } }) })

    const result = await cache.get('properties')
    expect(result.body.toString()).toBe(text)
    expect(result.contentType).toBe('text/plain')
    expect(result.attribution.hipsLicense).toBe('ODbL-1.0')
  })

  it('does not cache upstream errors, wrong media, invalid images or oversized streams', async () => {
    const location = await directory()

    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('<html>bad</html>', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('not a JPEG', { headers: { 'content-type': 'image/jpeg' } }))
      .mockResolvedValueOnce(response(2000))
      .mockResolvedValueOnce(response())

    const cache = createSurveyCache({ directory: location, fetch, maxBytes: 2048 })

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(cache.get('Norder0/Dir0/Npix1.jpg')).rejects.toThrow()
      expect((await readdir(location)).filter((name) => name.endsWith('.cache'))).toEqual([])
    }

    expect((await cache.get('Norder0/Dir0/Npix1.jpg')).body).toEqual(jpeg())
    expect(fetch).toHaveBeenCalledTimes(5)
  })

  it('evicts older demand-fetched entries to enforce the disk byte budget', async () => {
    const location = await directory()
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response(700))
    const cache = createSurveyCache({ directory: location, fetch, maxBytes: 2048 })
    await cache.get('Norder0/Dir0/Npix1.jpg')
    await cache.get('Norder0/Dir0/Npix2.jpg')
    const files = await readdir(location)
    const sizes = await Promise.all(files.map(async (name) => (await stat(join(location, name))).size))
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(2048)
    expect(files).toHaveLength(1)
    await cache.get('Norder0/Dir0/Npix2.jpg')
    expect(fetch).toHaveBeenCalledTimes(2)
    await cache.get('Norder0/Dir0/Npix1.jpg')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('aborts a stalled upstream request after the deadline without caching it', async () => {
    const location = await directory()

    const fetch = vi.fn<typeof globalThis.fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))

    const cache = createSurveyCache({ directory: location, fetch })
    vi.useFakeTimers()
    const request = cache.get('Norder0/Dir0/Npix1.jpg')
    const rejected = expect(request).rejects.toThrow('aborted')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(15000)
    await rejected
    expect(await readdir(location)).toEqual([])
  })

  it('uses one canonical fixed thumbnail request and bounds extent-derived framing', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => response())
    const cache = createSurveyCache({ directory: await directory(), fetch })
    await cache.thumbnail({ raDegrees: 12, decDegrees: -2, majorAxisArcminutes: 20 })
    await cache.thumbnail({ raDegrees: 12, decDegrees: -2, fovDegrees: 0.5 })
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(url.origin + url.pathname).toBe('https://alasky.cds.unistra.fr/hips-image-services/hips2fits')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      hips: 'CDS/P/DSS2/color', ra: '12', dec: '-2', fov: '0.5',
      width: '400', height: '300', coordsys: 'icrs', projection: 'TAN', format: 'jpg',
    })
    await cache.thumbnail({ raDegrees: 12, decDegrees: -2, majorAxisArcminutes: 1000 })
    expect(new URL(String(fetch.mock.calls[1]?.[0])).searchParams.get('fov')).toBe('5')
    expect(() => cache.thumbnail({ raDegrees: 360, decDegrees: 0 })).toThrow(RangeError)
    expect(() => cache.thumbnail({ raDegrees: 0, decDegrees: NaN })).toThrow(RangeError)
  })

  it('validates HTTP parameters and reports uncached upstream failure honestly', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('offline'))
    const app = Fastify()
    registerSurvey(app, createSurveyCache({ directory: await directory(), fetch }))

    try {
      for (const url of ['/api/survey/dss2/Norder0/Dir0/Npix12.jpg',
        '/api/survey/dss2/properties?url=https://example.org',
        '/api/survey/thumbnail?ra=0&dec=91&fov=1',
        '/api/survey/thumbnail?ra=0&dec=0&fov=1&url=https://example.org',
        '/api/survey/thumbnail?ra=0&ra=1&dec=0&fov=1']) {
        expect((await app.inject(url)).statusCode, url).toBe(400)
      }

      expect(fetch).not.toHaveBeenCalled()
      expect((await app.inject('/api/survey/dss2/Norder3/Allsky.jpg')).statusCode).toBe(503)
    } finally {
      await app.close()
    }
  })
})
