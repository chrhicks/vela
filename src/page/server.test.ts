import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { makeNight, type Night } from '../rig/night.ts'
import { makePicture } from '../rig/picture.ts'
import { connected, startedAt, wire } from '../testing/entries.ts'
import { makePage } from './server.ts'

const settings = { devices: { mount: 'mount', primary: 'primary', guide: 'guide', focuser: 'focuser', box: 'box' }, silenceMs: 10_000 }

const open: Array<ReturnType<typeof makePage>> = []

async function serve(refreshMs = 20) {
  const picture = makePicture()

  picture.apply(connected(startedAt), Date.now())
  picture.apply(wire(startedAt + 1, 'def', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 1200 }, 'Ok'), Date.now())
  picture.caughtUp()

  const server = makePage({ night: () => makeNight(picture, settings, Date.now()), refreshMs })

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

  it('answers anything else with 404', async () => {
    expect((await fetch(`${await serve()}/commands`, { method: 'POST' })).status).toBe(404)
  })
})
