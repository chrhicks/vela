import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { isSafeProfileId, parseProfile, parseSession } from './shared/persistence.ts'

const workshopRoot = dirname(fileURLToPath(import.meta.url))
const sessionPath = resolve(workshopRoot, '.local/session.json')
const designsPath = resolve(workshopRoot, 'designs')
const maxBodyBytes = 256 * 1024

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBodyBytes) throw new Error('Payload exceeds 256 KiB')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function localPersistencePlugin(): Plugin {
  return {
    name: 'vela-workshop-local-persistence',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith('/__workshop/')) return next()
        try {
          if (url.pathname === '/__workshop/session' && request.method === 'GET') {
            return json(response, 200, { session: await readJson(sessionPath) })
          }
          if (url.pathname === '/__workshop/session' && request.method === 'PUT') {
            const session = parseSession(await readBody(request))
            await writeJsonAtomic(sessionPath, session)
            return json(response, 200, { session })
          }
          if (url.pathname === '/__workshop/profiles' && request.method === 'GET') {
            await mkdir(designsPath, { recursive: true })
            const names = (await readdir(designsPath)).filter((name) => name.endsWith('.json')).sort()
            const profiles = []
            for (const name of names) {
              const value = await readJson(resolve(designsPath, name))
              profiles.push(parseProfile(value))
            }
            return json(response, 200, { profiles })
          }
          const profileMatch = url.pathname.match(/^\/__workshop\/profiles\/([a-z0-9-]+)$/)
          if (profileMatch && request.method === 'PUT') {
            const id = profileMatch[1] ?? ''
            if (!isSafeProfileId(id)) throw new Error('Invalid profile id')
            const profile = parseProfile(await readBody(request))
            if (profile.id !== id) throw new Error('Profile id does not match URL')
            await writeJsonAtomic(resolve(designsPath, `${id}.json`), profile)
            return json(response, 200, { profile })
          }
          return json(response, 404, { error: 'Unknown workshop persistence route' })
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : 'Persistence error' })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localPersistencePlugin()],
  server: {
    host: '127.0.0.1',
    fs: { allow: [resolve(workshopRoot, '../..')] },
    watch: {
      ignored: ['**/apps/workshop/.local/**', '**/apps/workshop/designs/*.json'],
    },
  },
})
