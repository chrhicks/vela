/** Development-only real-route review boundary. No device connection or production mock flag. */
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from '../apps/web/node_modules/vite/dist/node/index.js'
import { createReviewScene, reviewScenes } from '../apps/web/tests/fixtures/fieldroom/scenes.js'
import { reviewResources } from '../apps/web/tests/fixtures/fieldroom/resources.js'

const root = fileURLToPath(new URL('../', import.meta.url))

const resources = new Map<string, { body: Buffer; contentType: string }>()

for (const resource of reviewResources) {
  const body = await readFile(`${root}${resource.path}`)

  if (createHash('sha256').update(body).digest('hex') !== resource.sha256)
    throw new Error(`Review resource does not match its pinned hash: ${resource.resource}`)
  resources.set(resource.resource, { body, contentType: resource.contentType })
}

const sessions = new Map<string, NonNullable<ReturnType<typeof createReviewScene>>>()

const sessionId = (cookie: string | undefined) =>
  cookie
    ?.split('; ')
    .find((value) => value.startsWith('vela-review='))
    ?.slice('vela-review='.length)

const vite = await createViteServer({
  root: `${root}apps/web`,
  configFile: `${root}apps/web/vite.config.ts`,
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_THEME': JSON.stringify('fieldroom'),
  },
  server: { middlewareMode: true, proxy: {} },
  appType: 'custom',
})

const server = createHttpServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:5176')

    const sceneName = reviewScenes.find(
      (name) => name === url.pathname.slice('/__review/scene/'.length),
    )

    if (url.pathname.startsWith('/__review/scene/') && sceneName) {
      const id = randomUUID()
      const scene = createReviewScene(sceneName)!
      sessions.set(id, scene)

      // Bounded local review sessions; a fresh index selection always resets state.
      if (sessions.size > 50) sessions.delete(sessions.keys().next().value!)
      response
        .writeHead(302, {
          Location: scene.route,
          'Set-Cookie': `vela-review=${id}; Path=/; SameSite=Lax`,
        })
        .end()

      return
    }

    if (url.pathname === '/__review') {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          `<title>Fieldroom review</title><h1>Fieldroom review scenes</h1><p>Real application routes. Fixture API only; no hardware. Choose a scene to reset its state.</p><ul>${reviewScenes.map((name) => `<li><a href="/__review/scene/${name}">${name}</a></li>`).join('')}</ul>`,
        )

      return
    }

    const currentSession = sessionId(request.headers.cookie) ?? ''
    const scene = sessions.get(currentSession)

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!scene) {
        response
          .writeHead(409, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'Choose a review scene at /__review' }))

        return
      }

      let input = ''

      for await (const chunk of request) input += chunk

      const result = scene.respond(
        request.method ?? 'GET',
        `${url.pathname}${url.search}`,
        input ? JSON.parse(input) : undefined,
      )

      if (result.delayMs !== undefined) {
        if (!Number.isInteger(result.delayMs) || result.delayMs < 0 || result.delayMs > 60_000)
          throw new RangeError('Review response delay must be from 0 through 60000 milliseconds')
        await new Promise(resolve => setTimeout(resolve, result.delayMs))
      }

      const resourceId = result.resource ?? (result.image ? 'crescent' : undefined)
      const resource = resourceId ? resources.get(resourceId) : undefined

      if (resourceId && !resource) throw new Error(`Unknown review resource: ${resourceId}`)
      response
        .writeHead(result.status, {
          'Content-Type': resource?.contentType ?? 'application/json',
          'Cache-Control': 'no-store',
        })
        .end(resource ? resource.body : JSON.stringify(result.json))

      return
    }

    if (request.headers.accept?.includes('text/html')) {
      if (!scene) {
        response.writeHead(302, { Location: '/__review' }).end()

        return
      }

      let html = await readFile(`${root}apps/web/index.html`, 'utf8')
      // Fixed date affects fixtures only; timers still run so polling/retry evidence is real.
      const setup = `<script>try{if(sessionStorage.getItem('vela.review.scene')!==${JSON.stringify(currentSession)}){localStorage.setItem('vela.appearance',${JSON.stringify(scene.appearance)});sessionStorage.setItem('vela.review.scene',${JSON.stringify(currentSession)})}}catch{};{const NativeDate=Date;const fixed=${Date.parse(scene.time)};globalThis.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}}}</script>`
      html = html.replace('<head>', `<head>${setup}`)
      html = await vite.transformIndexHtml(url.pathname, html)
      response
        .writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
        .end(html)

      return
    }

    vite.middlewares(request, response, () => response.writeHead(404).end())
  } catch (error) {
    console.error(error)
    response.writeHead(500).end('Review server error')
  }
})

server.listen(5176, '127.0.0.1', () =>
  console.log('Fieldroom review: http://127.0.0.1:5176/__review'),
)
