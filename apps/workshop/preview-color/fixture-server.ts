import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { corpus } from './corpus.js'

export function previewColorFixtures(workshopRoot: string): Plugin {
  const files = new Set(['manifest.json'])

  for (const fixture of corpus) {
    for (const treatment of ['current', 'neutral']) {
      for (const scale of ['native', 'fit']) {
        files.add(`${fixture.key}-${treatment}-${scale}.png`)
      }
    }
  }

  return {
    name: 'workshop-preview-color-fixtures',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')

        if (!url.pathname.startsWith('/__preview-color/')) return next()
        const file = url.pathname.slice('/__preview-color/'.length)

        if (request.method !== 'GET' || !files.has(file)) {
          response.statusCode = 404
          response.end('Unknown read-only preview fixture')

          return
        }

        try {
          const bytes = await readFile(resolve(workshopRoot, '.local/preview-color', file))
          response.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : 'application/json')
          response.setHeader('Cache-Control', 'no-store')
          response.end(bytes)
        } catch (error) {
          response.statusCode = 503
          response.end('Local preview corpus unavailable. Run the workshop fixture generator.')
          server.config.logger.warn(`Preview fixture ${file}: ${String(error)}`)
        }
      })
    },
  }
}
