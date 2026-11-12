import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { entry, frameKept, runStarted, wire } from '../../state/testing.ts'
import { Feed, FeedLive } from './feed.ts'
import { FeedRoute, FeedServer, FeedSettings } from './route.ts'
import { ServiceStart, StartToken } from './start.ts'

const makeFeed = () => Effect.runPromise(Feed.pipe(Effect.provide(FeedLive)))

describe('Feed', () => {
  it('holds the state of the wanted entries taken so far, and leaves the rest out', async () => {
    const feed = await makeFeed()
    const started = runStarted('r1', 1000)

    await Effect.runPromise(feed.take(started))
    await Effect.runPromise(feed.take(wire('primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 3 })))

    const { state } = await Effect.runPromise(Effect.scoped(feed.follow))

    expect(state.run?.id).toBe('r1')
    expect(state.position).toBe(started.seq)
  })

  it('follows with the entries taken after the state, and only wanted ones', async () => {
    const feed = await makeFeed()
    const before = runStarted('r1', 1000)
    const after = frameKept('m31_001.fits', 2000)

    await Effect.runPromise(feed.take(before))

    const received = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { entries } = yield* feed.follow

          yield* feed.take(wire('primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 3 }))
          yield* feed.take(after)

          return yield* Stream.runCollect(Stream.take(entries, 1))
        }),
      ),
    )

    expect(received).toEqual([after])
  })

  it('passes on a malformed entry and reports it, leaving the state as it was', async () => {
    const feed = await makeFeed()
    const malformed = entry('vela.frame', 1, { night: 'tonight' })
    const taken = await Effect.runPromise(Effect.result(feed.take(malformed)))
    const { state } = await Effect.runPromise(Effect.scoped(feed.follow))

    expect(taken).toMatchObject({ _tag: 'Failure', failure: { _tag: 'MalformedEntry', kind: 'vela.frame' } })
    expect(state.position).toBeUndefined()
  })
})

describe('GET /feed', () => {
  it('sends the state with the start token first, then entries and heartbeats', async () => {
    const feed = await makeFeed()

    await Effect.runPromise(feed.take(runStarted('r1', 1000)))

    const services = Context.make(Feed, feed).pipe(Context.add(ServiceStart, { token: StartToken.make('1794500000000') }), Context.add(FeedSettings, { host: '127.0.0.1', port: 0, webRoot: '.', heartbeatSeconds: 0.05 }))
    const { handler, dispose } = HttpRouter.toWebHandler(FeedRoute, { disableLogger: true })
    const abort = new AbortController()
    const response = await handler(new Request('http://localhost/feed', { signal: abort.signal }), services)
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let text = ''

    await Effect.runPromise(feed.take(frameKept('m31_001.fits', 2000)))

    while (!text.includes('event: heartbeat')) text += (await reader.read()).value ?? ''

    abort.abort()
    await dispose()

    const events = text.split('\n\n').filter(Boolean).map(block => block.split('\n')[0])

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(events[0]).toBe('event: state')
    expect(JSON.parse(text.split('\n')[1]!.slice('data: '.length))).toMatchObject({ token: '1794500000000', state: { run: { id: 'r1' } } })
    expect(text).toContain('"kind":"vela.frame"')
    expect(events).toContain('event: heartbeat')
  })
})

describe('starting the event stream', () => {
  it('fails with a typed ServeError when the port is taken', async () => {
    const taken = createServer()

    await new Promise<void>(resolve => taken.listen(0, '127.0.0.1', resolve))

    const address = taken.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const app = FeedServer.pipe(
      Layer.provideMerge(FeedLive),
      Layer.provide(Layer.mergeAll(Layer.succeed(ServiceStart, { token: StartToken.make('1794500000000') }), Layer.succeed(FeedSettings, { host: '127.0.0.1', port, webRoot: '.', heartbeatSeconds: 5 }))),
    )
    const error = await Effect.runPromise(Effect.scoped(Effect.flip(Layer.build(app))))

    taken.close()

    expect(error).toMatchObject({ _tag: 'ServeError' })
    expect(String(error._tag === 'ServeError' && error.cause)).toContain('EADDRINUSE')
  })

  it('serves the web app at its own addresses, beside the event stream', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'vela-web-'))

    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Vela</title>')

    const app = FeedServer.pipe(
      Layer.provideMerge(FeedLive),
      Layer.provide(Layer.mergeAll(Layer.succeed(ServiceStart, { token: StartToken.make('1794500000000') }), Layer.succeed(FeedSettings, { host: '127.0.0.1', port: 0, webRoot, heartbeatSeconds: 5 }))),
    )
    const pages = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(app)
          const address = Context.get(context, HttpServer.HttpServer).address
          const port = address._tag === 'InetAddressV4' ? address.port : 0

          return yield* Effect.promise(() => Promise.all(['/', '/launch/align'].map(path => fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: 'text/html' } }).then(response => response.text()))))
        }),
      ),
    )

    expect(pages).toEqual(['<!doctype html><title>Vela</title>', '<!doctype html><title>Vela</title>'])
  })
})
