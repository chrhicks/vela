import { Context, Effect } from 'effect'
import { HttpRouter } from 'effect/http'
import { describe, expect, it } from 'vitest'
import { commandsPath } from '../../state/commands.ts'
import { CommandRefused, CommandsRoute, Operations } from './commands.ts'

function fakeOperations(refuse?: string) {
  const calls: Array<string> = []
  const carry = (name: string) => Effect.suspend(() => (calls.push(name), refuse === undefined ? Effect.void : Effect.fail(new CommandRefused({ text: refuse }))))

  return {
    calls,
    operations: { startAlignment: carry('startAlignment'), finishAlignment: carry('finishAlignment'), answerFilter: (filter: 'in' | 'out') => carry(`answerFilter ${filter}`) },
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

describe('POST /commands', () => {
  it('carries out a command and answers 202', async () => {
    expect(await post({ command: 'startAlignment' })).toEqual({ status: 202, body: undefined, calls: ['startAlignment'] })
    expect(await post({ command: 'answerFilter', filter: 'in' })).toMatchObject({ status: 202, calls: ['answerFilter in'] })
  })

  it("answers a refusal as data, with Vela's reason", async () => {
    expect(await post({ command: 'finishAlignment' }, 'no alignment is running')).toEqual({ status: 409, body: { code: 'refused', text: 'no alignment is running' }, calls: ['finishAlignment'] })
  })

  it('refuses a request it cannot read, and carries out nothing', async () => {
    expect(await post({ command: 'answerFilter', filter: 'sideways' })).toEqual({ status: 400, body: { code: 'malformed' }, calls: [] })
    expect(await post({ command: 'launchRocket' })).toEqual({ status: 400, body: { code: 'malformed' }, calls: [] })
  })
})
