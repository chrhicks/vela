import { Context, Effect } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { commandsPath, type Done } from '../../state/commands.ts'
import { CommandRefused, CommandsRoute, Operations } from './commands.ts'

function fakeOperations(refuse?: string) {
  const calls: Array<string> = []
  const carry = (name: string) => Effect.suspend(() => (calls.push(name), refuse === undefined ? Effect.void : Effect.fail(new CommandRefused({ refusal: { code: 'refused', text: refuse } }))))
  const answering = (name: string, done: Done) => carry(name).pipe(Effect.as(done))

  return {
    calls,
    operations: { startAlignment: carry('startAlignment'), finishAlignment: carry('finishAlignment'), answerFilter: (filter: 'in' | 'out') => carry(`answerFilter ${filter}`), home: answering('home', { code: 'home', endedRun: false }), stop: answering('stop', { code: 'stop', endedRun: true }), tracking: (on: boolean) => answering(`tracking ${on}`, { code: 'tracking', on }), nudge: (_id: unknown, direction: string, rate: string) => carry(`nudge ${direction} ${rate}`), holdNudge: () => Effect.sync(() => void calls.push('hold')), releaseNudge: () => carry('release'), slewAndCentre: (target: string) => answering(`centre ${target}`, { code: 'centring', target: 'Ring Nebula', endedRun: false }), flipNow: answering('flip', { code: 'flip-sent' }) },
  }
}

async function post(body: unknown, refuse?: string) {
  const { calls, operations } = fakeOperations(refuse)
  const { handler, dispose } = HttpRouter.toWebHandler(CommandsRoute, { disableLogger: true })
  const response = await handler(new Request(`http://localhost${commandsPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), Context.make(Operations, operations))
  const text = await response.text()

  await dispose()

  return { status: response.status, body: text === '' ? undefined : JSON.parse(text), calls }
}

const nudgeId = '6f1c0e2a-4b3d-4e5f-8a9b-0c1d2e3f4a5b'

describe('POST /commands', () => {
  it('carries out a command and answers 200 with what was done', async () => {
    expect(await post({ command: 'startAlignment' })).toEqual({ status: 200, body: { code: 'carried-out' }, calls: ['startAlignment'] })
    expect(await post({ command: 'tracking', on: true })).toEqual({ status: 200, body: { code: 'tracking', on: true }, calls: ['tracking true'] })
    expect(await post({ command: 'slewAndCentre', target: 'M 57' })).toEqual({ status: 200, body: { code: 'centring', target: 'Ring Nebula', endedRun: false }, calls: ['centre M 57'] })
    expect(await post({ command: 'answerFilter', filter: 'in' })).toMatchObject({ status: 200, calls: ['answerFilter in'] })
    expect(await post({ command: 'home' })).toMatchObject({ status: 200, calls: ['home'] })
    expect(await post({ command: 'stop' })).toMatchObject({ status: 200, calls: ['stop'] })
    expect(await post({ command: 'tracking', on: false })).toMatchObject({ status: 200, calls: ['tracking false'] })
    expect(await post({ command: 'nudge', id: nudgeId, direction: 'north', rate: 'fast' })).toMatchObject({ status: 200, calls: ['nudge north fast'] })
    expect(await post({ command: 'holdNudge', id: nudgeId })).toMatchObject({ status: 200, calls: ['hold'] })
    expect(await post({ command: 'releaseNudge', id: nudgeId })).toMatchObject({ status: 200, calls: ['release'] })
    expect(await post({ command: 'slewAndCentre', target: 'NGC 7635' })).toMatchObject({ status: 200, calls: ['centre NGC 7635'] })
    expect(await post({ command: 'flipNow' })).toMatchObject({ status: 200, calls: ['flip'] })
  })

  it("answers a refusal as data, with Vela's reason", async () => {
    expect(await post({ command: 'finishAlignment' }, 'no alignment is running')).toEqual({ status: 409, body: { code: 'refused', text: 'no alignment is running' }, calls: ['finishAlignment'] })
  })

  it('refuses a request it cannot read, and carries out nothing', async () => {
    expect(await post({ command: 'answerFilter', filter: 'sideways' })).toEqual({ status: 400, body: { code: 'malformed' }, calls: [] })
    expect(await post({ command: 'launchRocket' })).toEqual({ status: 400, body: { code: 'malformed' }, calls: [] })
    expect(await post({ command: 'nudge', id: 'not-a-uuid', direction: 'north', rate: 'fast' })).toEqual({ status: 400, body: { code: 'malformed' }, calls: [] })
  })
})
