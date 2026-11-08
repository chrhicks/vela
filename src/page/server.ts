import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Activity, Item } from '../activity/activity.ts'
import type { CaptureView, StartResult } from '../capture/run.ts'
import type { Pointing } from '../pointing/pointing.ts'
import type { PrepareResult } from '../prepare/prepare.ts'
import type { FrameDetail, Frames } from '../frames/library.ts'
import type { FocusDrift } from '../rig/focus.ts'
import type { Night } from '../rig/night.ts'

const page = readFileSync(new URL('./night.html', import.meta.url))
const font = readFileSync(new URL('./fonts/AtkinsonHyperlegibleNext.ttf', import.meta.url))

const previewPath = /^\/frames\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9._-]+\.fits)\.png$/
const detailPath = /^\/frames\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9._-]+\.fits)\.json$/

export interface PageOptions {
  readonly night: () => Night
  readonly focus: () => FocusDrift
  readonly refreshMs: number
  readonly frames: () => Promise<Frames>
  readonly preview: (night: string, file: string) => Promise<Buffer | undefined>
  readonly frame: (night: string, file: string) => Promise<FrameDetail | undefined>
  readonly activity: () => Activity & { readonly viewer: string | undefined }
  readonly capture: {
    readonly view: () => CaptureView
    readonly start: (request: unknown) => StartResult
    readonly stop: () => Promise<boolean>
  }
  readonly prepare: (request: unknown) => Promise<PrepareResult>
  readonly pointing: Pick<Pointing, 'view' | 'search' | 'preview'> & { readonly act: (request: unknown) => Promise<PrepareResult> }
}

export function makePage({ night: nightAlone, focus, refreshMs, frames, preview, frame, activity, capture, prepare, pointing }: PageOptions) {
  const watching = new Set<ServerResponse>()
  const night = () => ({ ...nightAlone(), focus: focus() })

  function send(response: ServerResponse, event: string, data: unknown) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const timer = setInterval(() => {
    if (watching.size === 0) return

    const snapshot = night()

    for (const response of watching) send(response, 'night', snapshot)

    captureChanged()
    pointingChanged()
  }, refreshMs)

  timer.unref()

  function fail(response: ServerResponse, error: unknown) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : String(error))
  }

  function captureChanged() {
    if (watching.size === 0) return

    const view = capture.view()

    for (const response of watching) send(response, 'capture', view)
  }

  function pointingChanged() {
    if (watching.size === 0) return

    const view = pointing.view()

    for (const response of watching) send(response, 'pointing', view)
  }

  function refuseUnlessJson(request: IncomingMessage, response: ServerResponse) {
    if (request.headers['content-type']?.split(';')[0]?.trim() === 'application/json') return false

    response.writeHead(415, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'send application/json' }))

    return true
  }

  async function readBody(request: IncomingMessage) {
    const chunks: Buffer[] = []

    for await (const chunk of request) chunks.push(chunk as Buffer)

    return Buffer.concat(chunks).toString('utf8')
  }

  function answer(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
  }

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''

    if (path === '/capture.json' && request.method === 'GET') {
      answer(response, 200, capture.view())

      return
    }

    if (path === '/capture' && request.method === 'POST') {
      if (refuseUnlessJson(request, response)) return

      readBody(request).then(text => {
        let json: unknown

        try {
          json = JSON.parse(text)
        } catch {
          answer(response, 400, { error: 'the body is not JSON' })

          return
        }

        const started = capture.start(json)

        if (started.ok) answer(response, 202, { run: started.run })
        else answer(response, 409, { error: started.reason })
      }, error => fail(response, error))

      return
    }

    const acts = path === '/prepare' ? prepare : path === '/pointing' ? pointing.act : undefined

    if (acts !== undefined && request.method === 'POST') {
      if (refuseUnlessJson(request, response)) return

      readBody(request).then(async text => {
        let json: unknown

        try {
          json = JSON.parse(text)
        } catch {
          answer(response, 400, { error: 'the body is not JSON' })

          return
        }

        const result = await acts(json)

        if (result.ok) answer(response, 200, { ok: true })
        else answer(response, 409, { error: result.reason })
      }, error => fail(response, error))

      return
    }

    if (path === '/targets' && request.method === 'GET') {
      answer(response, 200, pointing.search(new URL(request.url ?? '', 'http://localhost').searchParams.get('q') ?? ''))

      return
    }

    if (path === '/target' && request.method === 'GET') {
      answer(response, 200, pointing.preview(new URL(request.url ?? '', 'http://localhost').searchParams.get('id') ?? ''))

      return
    }

    if (path === '/capture/stop' && request.method === 'POST') {
      if (refuseUnlessJson(request, response)) return

      capture.stop().then(stopped => answer(response, 200, { stopped }), error => fail(response, error))

      return
    }

    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(page)

      return
    }

    if (path === '/fonts/atkinson-hyperlegible-next.ttf') {
      response.writeHead(200, { 'content-type': 'font/ttf', 'cache-control': 'max-age=604800' })
      response.end(font)

      return
    }

    if (path === '/night.json') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(night()))

      return
    }

    if (path === '/activity.json') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(activity()))

      return
    }

    if (path === '/frames.json') {
      frames().then(list => {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify(list))
      }, error => fail(response, error))

      return
    }

    const detailed = detailPath.exec(path)

    if (detailed !== null) {
      frame(detailed[1] ?? '', detailed[2] ?? '').then(detail => {
        if (detail === undefined) response.writeHead(404).end()
        else {
          response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          response.end(JSON.stringify(detail))
        }
      }, error => fail(response, error))

      return
    }

    const previewed = previewPath.exec(path)

    if (previewed !== null) {
      preview(previewed[1] ?? '', previewed[2] ?? '').then(png => {
        if (png === undefined) response.writeHead(404).end()
        else {
          response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
          response.end(png)
        }
      }, error => fail(response, error))

      return
    }

    if (path === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      response.flushHeaders()
      watching.add(response)
      response.on('close', () => watching.delete(response))
      send(response, 'night', night())
      send(response, 'capture', capture.view())
      send(response, 'pointing', pointing.view())
      send(response, 'activity', activity())
      frames().then(list => send(response, 'frames', list), () => undefined)

      return
    }

    response.writeHead(404).end()
  })

  server.on('close', () => clearInterval(timer))

  function framesChanged() {
    if (watching.size === 0) return

    frames().then(
      list => {
        for (const response of watching) send(response, 'frames', list)
      },
      () => undefined,
    )
  }

  function activityAdded(item: Item) {
    for (const response of watching) send(response, 'activity-item', item)
  }

  return { server, framesChanged, captureChanged, activityAdded }
}
