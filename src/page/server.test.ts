import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { makeNight, type Night } from '../rig/night.ts'
import { makePicture } from '../rig/picture.ts'
import { connected, startedAt, wire } from '../testing/entries.ts'
import { makePage, type PageOptions } from './server.ts'

const settings = { devices: { mount: 'mount', primary: 'primary', guide: 'guide', focuser: 'focuser', box: 'box' }, silenceMs: 10_000, focuserNudgeSteps: 100 }

const open: Array<ReturnType<typeof makePage>['server']> = []

const idleView = { at: 1, run: undefined, last: undefined }

const idlePrepare: PageOptions['prepare'] = async () => ({ ok: false, reason: 'not here' })

const idlePointingView = { at: 1, parked: undefined, tracking: undefined, goto: undefined }

const idlePointing: PageOptions['pointing'] = {
  view: () => idlePointingView,
  search: () => [],
  preview: id => ({ ok: false, reason: `no catalog target ${id}` }),
  act: async () => ({ ok: false, reason: 'not here' }),
}

const idleCapture: PageOptions['capture'] = { view: () => idleView, start: () => ({ ok: false, reason: 'not here' }), stop: async () => false }

async function serve(refreshMs = 20, frames: Partial<Pick<PageOptions, 'frames' | 'preview' | 'capture' | 'prepare' | 'pointing'>> = {}) {
  const picture = makePicture()

  picture.apply(connected(startedAt), Date.now())
  picture.apply(wire(startedAt + 1, 'def', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 1200 }, 'Ok'), Date.now())
  picture.caughtUp()

  const { server } = makePage({ night: () => makeNight(picture, settings, Date.now()), refreshMs, frames: async () => ({ night: '2026-11-07', frames: [] }), preview: async () => undefined, capture: idleCapture, prepare: idlePrepare, pointing: idlePointing, ...frames })

  open.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))

  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterEach(async () => {
  await Promise.all(open.splice(0).map(server => new Promise<void>(resolve => (server.closeAllConnections(), server.close(() => resolve())))))
})

describe('page server', () => {
  it('serves the hand-written page', async () => {
    const response = await fetch(`${await serve()}/`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('new EventSource')
  })

  it('serves the current picture as json', async () => {
    const response = await fetch(`${await serve()}/night.json`)
    const night = (await response.json()) as Night

    expect(response.headers.get('content-type')).toBe('application/json')
    expect(night.phase).toBe('live')
    expect(night.devices.find(device => device.id === 'focuser')?.fields[0]).toMatchObject({ label: 'Position', text: '1200 steps', status: 'current' })
  })

  it('sends the picture at once and again on each refresh over server-sent events', async () => {
    const response = await fetch(`${await serve()}/events`)
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''

    expect(response.headers.get('content-type')).toBe('text/event-stream')

    while ((text.match(/event: night/g) ?? []).length < 3) {
      const chunk = await reader?.read()

      if (chunk === undefined || chunk.done) break
      text += decoder.decode(chunk.value)
    }

    await reader?.cancel()

    const events = text.split('\n\n').filter(part => part.startsWith('event: night'))

    expect(events.length).toBeGreaterThanOrEqual(3)
    expect(JSON.parse(events[0]?.split('data: ')[1] ?? '').phase).toBe('live')
  })

  it('lists the night\'s kept frames as json', async () => {
    const frames = { night: '2026-11-07', frames: [{ file: 'a_001.fits', bytes: 5, keptAt: '2026-11-08T03:00:00.000Z' }] }
    const response = await fetch(`${await serve(20, { frames: async () => frames })}/frames.json`)

    expect(await response.json()).toEqual(frames)
  })

  it('sends the frames list over server-sent events as soon as one connects', async () => {
    const frames = { night: '2026-11-07', frames: [] }
    const response = await fetch(`${await serve(20, { frames: async () => frames })}/events`)
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''

    while (!text.includes('event: frames')) {
      const chunk = await reader?.read()

      if (chunk === undefined || chunk.done) break
      text += decoder.decode(chunk.value)
    }

    await reader?.cancel()

    expect(text).toContain(`event: frames\ndata: ${JSON.stringify(frames)}`)
  })

  it('serves a frame preview as a png, and 404 for a frame it does not have', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const base = await serve(20, { preview: async (night, file) => (night === '2026-11-07' && file === 'a_001.fits' ? png : undefined) })
    const found = await fetch(`${base}/frames/2026-11-07/a_001.fits.png`)

    expect(found.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await found.arrayBuffer())).toEqual(png)
    expect((await fetch(`${base}/frames/2026-11-07/b_001.fits.png`)).status).toBe(404)
    expect((await fetch(`${base}/frames/2026-11-07/..%2Fx.png`)).status).toBe(404)
  })

  it('says why a preview could not be made', async () => {
    const response = await fetch(`${await serve(20, { preview: async () => Promise.reject(new Error('the frame has no Bayer pattern')) })}/frames/2026-11-07/a_001.fits.png`)

    expect(response.status).toBe(500)
    expect(await response.text()).toContain('Bayer')
  })

  it('answers anything else with 404', async () => {
    expect((await fetch(`${await serve()}/commands`, { method: 'POST' })).status).toBe(404)
  })

  it('starts a capture run from a json body and says why when it will not start', async () => {
    const started: unknown[] = []
    const base = await serve(20, { capture: { ...idleCapture, start: request => (started.push(request), { ok: true, run: 'run-1', done: Promise.resolve() }) } })
    const post = (body: string) => fetch(`${base}/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const accepted = await post('{"object":"M 31"}')

    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ run: 'run-1' })
    expect(started).toEqual([{ object: 'M 31' }])
    expect((await post('not json')).status).toBe(400)

    const refused = await fetch(`${await serve()}/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'not here' })
  })

  it('refuses to start or stop a run from a request a web page could send without asking the browser first', async () => {
    const base = await serve()

    expect((await fetch(`${base}/capture`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await fetch(`${base}/capture/stop`, { method: 'POST' })).status).toBe(415)
  })

  it('passes a preparation request on and says why it was refused', async () => {
    const received: unknown[] = []
    const base = await serve(20, { prepare: async request => (received.push(request), request === 'ok' ? { ok: true } : { ok: false, reason: 'position 70000 is outside the limits' }) })
    const post = (body: string) => fetch(`${base}/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const accepted = await post('"ok"')
    const refused = await post('{"action":"focuser-move"}')

    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ ok: true })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'position 70000 is outside the limits' })
    expect((await post('not json')).status).toBe(400)
    expect(received).toEqual(['ok', { action: 'focuser-move' }])
  })

  it('refuses a preparation request a web page could send without asking the browser first', async () => {
    expect((await fetch(`${await serve()}/prepare`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
  })

  it('passes a pointing request on, searches the catalog and previews a target', async () => {
    const received: unknown[] = []
    const base = await serve(20, {
      pointing: {
        ...idlePointing,
        act: async request => (received.push(request), { ok: true }),
        search: text => [{ id: 'ngc0224', name: text, commonName: null, type: 'Galaxy', constellation: null }],
      },
    })
    const response = await fetch(`${base}/pointing`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"stop"}' })

    expect(response.status).toBe(200)
    expect(received).toEqual([{ action: 'stop' }])
    expect((await fetch(`${base}/pointing`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect(await (await fetch(`${base}/targets?q=m31`)).json()).toEqual([{ id: 'ngc0224', name: 'm31', commonName: null, type: 'Galaxy', constellation: null }])
    expect(await (await fetch(`${base}/target?id=x`)).json()).toEqual({ ok: false, reason: 'no catalog target x' })
  })

  it('stops the run and says whether there was one', async () => {
    const base = await serve(20, { capture: { ...idleCapture, stop: async () => true } })
    const response = await fetch(`${base}/capture/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })

    expect(await response.json()).toEqual({ stopped: true })
  })

  it('serves the capture view as json and sends it over server-sent events', async () => {
    const base = await serve()

    expect(await (await fetch(`${base}/capture.json`)).json()).toEqual(idleView)

    const response = await fetch(`${base}/events`)
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let text = ''

    while (!text.includes('event: capture')) {
      const chunk = await reader?.read()

      if (chunk === undefined || chunk.done) break
      text += decoder.decode(chunk.value)
    }

    await reader?.cancel()

    expect(text).toContain(`event: capture\ndata: ${JSON.stringify(idleView)}`)
  })
})
