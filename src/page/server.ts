import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { Frames } from '../frames/library.ts'
import type { Night } from '../rig/night.ts'

const page = readFileSync(new URL('./night.html', import.meta.url))

const previewPath = /^\/frames\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9._-]+\.fits)\.png$/

export interface PageOptions {
  readonly night: () => Night
  readonly refreshMs: number
  readonly frames: () => Promise<Frames>
  readonly preview: (night: string, file: string) => Promise<Buffer | undefined>
}

export function makePage({ night, refreshMs, frames, preview }: PageOptions) {
  const watching = new Set<ServerResponse>()

  function send(response: ServerResponse, event: string, data: unknown) {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const timer = setInterval(() => {
    if (watching.size === 0) return

    const snapshot = night()

    for (const response of watching) send(response, 'night', snapshot)
  }, refreshMs)

  timer.unref()

  function fail(response: ServerResponse, error: unknown) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : String(error))
  }

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''

    if (path === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(page)

      return
    }

    if (path === '/night.json') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify(night()))

      return
    }

    if (path === '/frames.json') {
      frames().then(list => {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify(list))
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

  return { server, framesChanged }
}
