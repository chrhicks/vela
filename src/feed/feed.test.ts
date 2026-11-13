import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Effect, Layer, Stream } from 'effect'
import { HttpRouter, HttpServer } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { entry, frameKept, runStarted, wire } from '../../state/testing.ts'
import { Feed, FeedLive } from './feed.ts'
import { NightName } from '../../state/entries.ts'
import { Operations } from './commands.ts'
import { FeedRoute, FeedServer, FeedSettings, Tonight } from './route.ts'
import { StartToken } from '../../state/feed.ts'
import type { Done } from '../../state/commands.ts'
import { ServiceStart } from './start.ts'

const answered = (done: Done) => Effect.succeed(done)

const makeFeed = () => Effect.runPromise(Feed.pipe(Effect.provide(FeedLive)))

describe('Feed', () => {
  it('holds the state of the wanted entries received so far, and leaves the rest out', async () => {
    const feed = await makeFeed()
    const started = runStarted('r1', 1000)

    await Effect.runPromise(feed.receive(started))
    await Effect.runPromise(feed.receive(wire('primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 3 })))

    const { state } = await Effect.runPromise(Effect.scoped(feed.subscribe))

    expect(state.run?.id).toBe('r1')
    expect(state.position).toBe(started.seq)
  })

  it('subscribes with the state, then the wanted entries received after it', async () => {
    const feed = await makeFeed()
    const before = runStarted('r1', 1000)
    const after = frameKept('m31_001.fits', 2000)

    await Effect.runPromise(feed.receive(before))

    const received = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { entries } = yield* feed.subscribe

          yield* feed.receive(wire('primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 3 }))
          yield* feed.receive(after)

          return yield* Stream.runCollect(Stream.take(entries, 1))
        }),
      ),
    )

    expect(received).toEqual([after])
  })

  it('passes on a malformed entry and reports it, leaving the state as it was', async () => {
    const feed = await makeFeed()
    const malformed = entry('vela.frame', 1, { night: 'tonight' })
    const taken = await Effect.runPromise(Effect.result(feed.receive(malformed)))
    const { state } = await Effect.runPromise(Effect.scoped(feed.subscribe))

    expect(taken).toMatchObject({ _tag: 'Failure', failure: { _tag: 'MalformedEntry', kind: 'vela.frame' } })
    expect(state.position).toBeUndefined()
  })
})

describe('GET /feed', () => {
  it('sends the state with the start token first, then entries and heartbeats', async () => {
    const feed = await makeFeed()

    await Effect.runPromise(feed.receive(runStarted('r1', 1000)))

    const services = Context.make(Feed, feed).pipe(Context.add(ServiceStart, { token: StartToken.make('1794500000000') }), Context.add(Tonight, { nightOf: () => NightName.make('2026-11-08') }), Context.add(FeedSettings, { host: '127.0.0.1', port: 0, webRoot: '.', heartbeatSeconds: 0.05, lostAfterSeconds: 15, rigSilentAfterSeconds: 10, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50] } }))
    const { handler, dispose } = HttpRouter.toWebHandler(FeedRoute, { disableLogger: true })
    const abort = new AbortController()
    const response = await handler(new Request('http://localhost/feed', { signal: abort.signal }), services)
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
    let text = ''

    await Effect.runPromise(feed.receive(frameKept('m31_001.fits', 2000)))

    while (!text.includes('event: heartbeat')) text += (await reader.read()).value ?? ''

    abort.abort()
    await dispose()

    const events = text.split('\n\n').filter(Boolean).map(block => block.split('\n')[0])

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(events[0]).toBe('event: state')
    expect(JSON.parse(text.split('\n')[1]!.slice('data: '.length))).toMatchObject({ token: '1794500000000', night: '2026-11-08', state: { run: { id: 'r1' } } })
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
      Layer.provide(Layer.mergeAll(Layer.succeed(ServiceStart, { token: StartToken.make('1794500000000') }), Layer.succeed(Tonight, { nightOf: () => NightName.make('2026-11-08') }), Layer.succeed(Operations, { startAlignment: Effect.void, finishAlignment: Effect.void, answerFilter: () => Effect.void, home: answered({ code: 'home', endedRun: false }), stop: answered({ code: 'stop', endedRun: false }), tracking: on => answered({ code: 'tracking', on }), nudge: () => Effect.void, holdNudge: () => Effect.void, releaseNudge: () => Effect.void, slewAndCentre: target => answered({ code: 'centring', target, endedRun: false }), flipNow: answered({ code: 'flip', settled: true, flipped: false, pausedRun: false }), focusTo: position => answered({ code: 'focusing', position }), focusBy: steps => answered({ code: 'focusing', position: steps }) }), Layer.succeed(FeedSettings, { host: '127.0.0.1', port, webRoot: '.', heartbeatSeconds: 5, lostAfterSeconds: 15, rigSilentAfterSeconds: 10, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50] } }))),
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
      Layer.provide(Layer.mergeAll(Layer.succeed(ServiceStart, { token: StartToken.make('1794500000000') }), Layer.succeed(Tonight, { nightOf: () => NightName.make('2026-11-08') }), Layer.succeed(Operations, { startAlignment: Effect.void, finishAlignment: Effect.void, answerFilter: () => Effect.void, home: answered({ code: 'home', endedRun: false }), stop: answered({ code: 'stop', endedRun: false }), tracking: on => answered({ code: 'tracking', on }), nudge: () => Effect.void, holdNudge: () => Effect.void, releaseNudge: () => Effect.void, slewAndCentre: target => answered({ code: 'centring', target, endedRun: false }), flipNow: answered({ code: 'flip', settled: true, flipped: false, pausedRun: false }), focusTo: position => answered({ code: 'focusing', position }), focusBy: steps => answered({ code: 'focusing', position: steps }) }), Layer.succeed(FeedSettings, { host: '127.0.0.1', port: 0, webRoot, heartbeatSeconds: 5, lostAfterSeconds: 15, rigSilentAfterSeconds: 10, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50] } }))),
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
