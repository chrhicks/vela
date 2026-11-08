import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { Night } from '../rig/night.ts'

const page = readFileSync(new URL('./night.html', import.meta.url))

export interface PageOptions {
  readonly night: () => Night
  readonly refreshMs: number
}

export function makePage({ night, refreshMs }: PageOptions) {
  const watching = new Set<ServerResponse>()

  function send(response: ServerResponse, snapshot: Night) {
    response.write(`event: night\ndata: ${JSON.stringify(snapshot)}\n\n`)
  }

  const timer = setInterval(() => {
    if (watching.size === 0) return

    const snapshot = night()

    for (const response of watching) send(response, snapshot)
  }, refreshMs)

  timer.unref()

  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0]

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

    if (path === '/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      response.flushHeaders()
      watching.add(response)
      response.on('close', () => watching.delete(response))
      send(response, night())

      return
    }

    response.writeHead(404).end()
  })

  server.on('close', () => clearInterval(timer))

  return server
}
