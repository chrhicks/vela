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
import { CommandLog, Operations } from './commands.ts'
import { FeedRoute, FeedServer, FeedSettings, Tonight } from './route.ts'
import { Recalled } from './remembered.ts'
import { SkyNow } from './sky.ts'
import { DevelopedFrames } from './crops.ts'
import { PreviewFailed, Previews } from './previews.ts'
import { StackPictures } from './stack.ts'
import { DetailSurveyKept, SurveyKept } from './survey.ts'
import { Targets } from './targets.ts'
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

    const services = Context.make(Feed, feed).pipe(Context.add(ServiceStart, { token: StartToken.make('1794500000000') }), Context.add(Tonight, { nightOf: () => NightName.make('2026-11-08') }), Context.add(FeedSettings, { host: '127.0.0.1', port: 0, webRoot: '.', heartbeatSeconds: 0.05, lostAfterSeconds: 15, rigSilentAfterSeconds: 10, firstFrames: { skippedFrames: 2, checkedFrames: 3, focusRatio: 1.3, trailedElongation: 1.5 }, picker: { wheelPixelsPerDoubling: 200, zoomGlideMs: 150 }, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50], autofocusExposureSeconds: { in: 10, out: 2 }, coolerCelsius: -10, dewChannel: 'DEW_CHANNEL_1', dewPercent: 60, testFrameSeconds: 2, calibrationFrames: 30 } }))
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
      Layer.provide(Layer.mergeAll(Layer.succeed(ServiceStart, { token: StartToken.make('1794500000000') }), Layer.succeed(Tonight, { nightOf: () => NightName.make('2026-11-08') }), Layer.succeed(SkyNow, { tonight: Effect.succeed(null) }), Layer.succeed(SurveyKept, { survey: null, tilesDir: '/nonexistent' }), Layer.succeed(DetailSurveyKept, { survey: null, tilesDir: '/nonexistent' }), Layer.succeed(DevelopedFrames, { get: () => Effect.succeed(undefined) }), Layer.succeed(Previews, { get: (night, file) => (file === 'broken.fits' ? Effect.fail(new PreviewFailed({ night, file, cause: 'not a picture' })) : Effect.succeed(file === 'kept.fits' ? Uint8Array.from([137, 80, 78, 71]) : undefined)) }), Layer.succeed(StackPictures, { picture: (_night, sequence) => Effect.succeed(sequence === 'M-33_light' ? { png: Uint8Array.from([137, 80, 78, 71]), frames: 3 } : undefined) }), Layer.succeed(Recalled, { now: Effect.succeed({ lastLight: null, cameraAngleDegrees: null }) }), Layer.succeed(CommandLog, { newId: Effect.succeed('press-1'), pressed: () => Effect.void, answered: () => Effect.void }), Layer.succeed(Targets, { search: () => Effect.succeed([]), bestPlaced: () => Effect.succeed([]), facts: () => Effect.succeed(undefined), size: 0 }), Layer.succeed(Operations, { startAlignment: Effect.void, finishAlignment: Effect.void, answerFilter: () => Effect.void, home: answered({ code: 'home', endedRun: false }), stop: answered({ code: 'stop', endedRun: false }), tracking: on => answered({ code: 'tracking', on }), nudge: () => Effect.void, holdNudge: () => Effect.void, releaseNudge: () => Effect.void, slewAndCentre: target => answered({ code: 'centring', target, endedRun: false }), flipNow: answered({ code: 'flip', settled: true, flipped: false, pausedRun: false }), focusTo: position => answered({ code: 'focusing', position }), focusBy: steps => answered({ code: 'focusing', position: steps }), autofocus: exposureSeconds => answered({ code: 'autofocusing', exposureSeconds, endedRun: false }), coolTo: celsius => answered({ code: 'cooling', celsius }), coolerOff: answered({ code: 'cooler-off' }), stopForTheNight: answered({ code: 'stopped-for-night', endedRun: false, missed: [] }), dewAuto: answered({ code: 'dew-auto' }), dewFixed: (percent: number) => answered({ code: 'dew-fixed', percent }), dewOff: answered({ code: 'dew-off' }), startGuiding: answered({ code: 'guiding-starting', recalibrate: false }), stopGuiding: answered({ code: 'guiding-stopped' }), pickGuideStar: answered({ code: 'guiding-starting', recalibrate: false }), calibrateGuiding: answered({ code: 'guiding-starting', recalibrate: true }), takeDarkFlats: (frames: number, exposureSeconds: number, celsius: number) => answered({ code: 'dark-flats', frames, exposureSeconds, celsius }), takeBias: (frames: number, celsius: number) => answered({ code: 'bias', frames, celsius }), takeFlats: (frames: number, celsius: number) => answered({ code: 'flats', frames, celsius }), startTarget: () => answered({ code: 'carried-out' }), testFrame: exposureSeconds => answered({ code: 'test-frame', exposureSeconds, sequence: 'test-frame_light' }), takeDarks: (frames, exposureSeconds, celsius) => answered({ code: 'darks', frames, exposureSeconds, celsius }) }), Layer.succeed(FeedSettings, { host: '127.0.0.1', port, webRoot: '.', heartbeatSeconds: 5, lostAfterSeconds: 15, rigSilentAfterSeconds: 10, firstFrames: { skippedFrames: 2, checkedFrames: 3, focusRatio: 1.3, trailedElongation: 1.5 }, picker: { wheelPixelsPerDoubling: 200, zoomGlideMs: 150 }, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50], autofocusExposureSeconds: { in: 10, out: 2 }, coolerCelsius: -10, dewChannel: 'DEW_CHANNEL_1', dewPercent: 60, testFrameSeconds: 2, calibrationFrames: 30 } }))),
    )
    const error = await Effect.runPromise(Effect.scoped(Effect.flip(Layer.build(app))))

    taken.close()

    expect(error).toMatchObject({ _tag: 'ServeError' })
    expect(String(error._tag === 'ServeError' && error.cause)).toContain('EADDRINUSE')
  })

  it("serves the web app at its own addresses, kept frames' previews and the night's stacks, beside the event stream", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'vela-web-'))

    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>Vela</title>')

    const app = FeedServer.pipe(
      Layer.provideMerge(FeedLive),
      Layer.provide(Layer.mergeAll(Layer.succeed(ServiceStart, { token: StartToken.make('1794500000000') }), Layer.succeed(Tonight, { nightOf: () => NightName.make('2026-11-08') }), Layer.succeed(SkyNow, { tonight: Effect.succeed(null) }), Layer.succeed(SurveyKept, { survey: null, tilesDir: '/nonexistent' }), Layer.succeed(DetailSurveyKept, { survey: null, tilesDir: '/nonexistent' }), Layer.succeed(DevelopedFrames, { get: () => Effect.succeed(undefined) }), Layer.succeed(Previews, { get: (night, file) => (file === 'broken.fits' ? Effect.fail(new PreviewFailed({ night, file, cause: 'not a picture' })) : Effect.succeed(file === 'kept.fits' ? Uint8Array.from([137, 80, 78, 71]) : undefined)) }), Layer.succeed(StackPictures, { picture: (_night, sequence) => Effect.succeed(sequence === 'M-33_light' ? { png: Uint8Array.from([137, 80, 78, 71]), frames: 3 } : undefined) }), Layer.succeed(Recalled, { now: Effect.succeed({ lastLight: null, cameraAngleDegrees: null }) }), Layer.succeed(CommandLog, { newId: Effect.succeed('press-1'), pressed: () => Effect.void, answered: () => Effect.void }), Layer.succeed(Targets, { search: () => Effect.succeed([]), bestPlaced: () => Effect.succeed([]), facts: () => Effect.succeed(undefined), size: 0 }), Layer.succeed(Operations, { startAlignment: Effect.void, finishAlignment: Effect.void, answerFilter: () => Effect.void, home: answered({ code: 'home', endedRun: false }), stop: answered({ code: 'stop', endedRun: false }), tracking: on => answered({ code: 'tracking', on }), nudge: () => Effect.void, holdNudge: () => Effect.void, releaseNudge: () => Effect.void, slewAndCentre: target => answered({ code: 'centring', target, endedRun: false }), flipNow: answered({ code: 'flip', settled: true, flipped: false, pausedRun: false }), focusTo: position => answered({ code: 'focusing', position }), focusBy: steps => answered({ code: 'focusing', position: steps }), autofocus: exposureSeconds => answered({ code: 'autofocusing', exposureSeconds, endedRun: false }), coolTo: celsius => answered({ code: 'cooling', celsius }), coolerOff: answered({ code: 'cooler-off' }), stopForTheNight: answered({ code: 'stopped-for-night', endedRun: false, missed: [] }), dewAuto: answered({ code: 'dew-auto' }), dewFixed: (percent: number) => answered({ code: 'dew-fixed', percent }), dewOff: answered({ code: 'dew-off' }), startGuiding: answered({ code: 'guiding-starting', recalibrate: false }), stopGuiding: answered({ code: 'guiding-stopped' }), pickGuideStar: answered({ code: 'guiding-starting', recalibrate: false }), calibrateGuiding: answered({ code: 'guiding-starting', recalibrate: true }), takeDarkFlats: (frames: number, exposureSeconds: number, celsius: number) => answered({ code: 'dark-flats', frames, exposureSeconds, celsius }), takeBias: (frames: number, celsius: number) => answered({ code: 'bias', frames, celsius }), takeFlats: (frames: number, celsius: number) => answered({ code: 'flats', frames, celsius }), startTarget: () => answered({ code: 'carried-out' }), testFrame: exposureSeconds => answered({ code: 'test-frame', exposureSeconds, sequence: 'test-frame_light' }), takeDarks: (frames, exposureSeconds, celsius) => answered({ code: 'darks', frames, exposureSeconds, celsius }) }), Layer.succeed(FeedSettings, { host: '127.0.0.1', port: 0, webRoot, heartbeatSeconds: 5, lostAfterSeconds: 15, rigSilentAfterSeconds: 10, firstFrames: { skippedFrames: 2, checkedFrames: 3, focusRatio: 1.3, trailedElongation: 1.5 }, picker: { wheelPixelsPerDoubling: 200, zoomGlideMs: 150 }, launch: { alignGoodArcmin: 1, alignMovedArcmin: 10 }, controls: { nudgeHoldMs: 250, focusSteps: [10, 50], autofocusExposureSeconds: { in: 10, out: 2 }, coolerCelsius: -10, dewChannel: 'DEW_CHANNEL_1', dewPercent: 60, testFrameSeconds: 2, calibrationFrames: 30 } }))),
    )
    const { texts: pages, previews } = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(app)
          const address = Context.get(context, HttpServer.HttpServer).address
          const port = address._tag === 'InetAddressV4' ? address.port : 0

          const texts = yield* Effect.promise(() => Promise.all(['/', '/launch/align'].map(path => fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: 'text/html' } }).then(response => response.text()))))
          const previews = yield* Effect.promise(() =>
            Promise.all(
              ['preview?night=2026-11-15&file=kept.fits', 'preview?night=2026-11-15&file=other.fits', 'preview?night=2026-11-15&file=broken.fits', 'preview?night=tonight&file=kept.fits', 'stack-picture?night=2026-11-15&sequence=M-33_light&frames=3', 'stack-picture?night=2026-11-15&sequence=M-33_light&frames=2', 'stack-picture?night=2026-11-15&sequence=M-33_light', 'stack-picture?night=2026-11-15&sequence=NGC-7635_light'].map(query =>
                fetch(`http://127.0.0.1:${port}/${query}`).then(async response => ({ status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), bytes: [...new Uint8Array(await response.arrayBuffer())] })),
              ),
            ),
          )

          return { texts, previews }
        }),
      ),
    )

    expect(pages).toEqual(['<!doctype html><title>Vela</title>', '<!doctype html><title>Vela</title>'])
    expect(previews).toEqual([
      { status: 200, type: 'image/png', cache: 'public, max-age=31536000, immutable', bytes: [137, 80, 78, 71] },
      { status: 404, type: null, cache: null, bytes: [] },
      { status: 500, type: null, cache: null, bytes: [] },
      { status: 400, type: null, cache: null, bytes: [] },
      { status: 200, type: 'image/png', cache: 'public, max-age=31536000, immutable', bytes: [137, 80, 78, 71] },
      { status: 200, type: 'image/png', cache: 'no-store', bytes: [137, 80, 78, 71] },
      { status: 200, type: 'image/png', cache: 'no-store', bytes: [137, 80, 78, 71] },
      { status: 404, type: null, cache: null, bytes: [] },
    ])
  })
})
