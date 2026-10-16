import { Effect, Exit, Option, Schema } from 'effect'
import { ErrorBody, type ErrorCode, type OperationRequest, type RecoveryRequest } from '@cria/wire'

export interface CriaConnection {
  readonly origin: string
  readonly token: string | undefined
  readonly fetch: typeof globalThis.fetch
}

/** `lost`: no readable answer, so the request may or may not have reached Cria. */
export type Reply<A> =
  | { readonly kind: 'answered'; readonly body: A }
  | { readonly kind: 'refused'; readonly code: ErrorCode; readonly message: string }
  | { readonly kind: 'lost'; readonly message: string }

type Decodable = Schema.Top & { readonly DecodingServices: never }

const replyWithin = '2 seconds'

export function request<S extends Decodable>(
  connection: CriaConnection,
  method: 'GET' | 'POST',
  path: string,
  schema: S,
  body?: OperationRequest | RecoveryRequest,
): Effect.Effect<Reply<S['Type']>> {
  return exchange(connection, method, path, body).pipe(
    Effect.map(exchanged => {
      if (exchanged.kind === 'lost') return exchanged

      const text = new TextDecoder().decode(exchanged.bytes)

      if (exchanged.status >= 200 && exchanged.status < 300) return decoded(schema, text, path)

      return refusal(exchanged.status, text, path)
    }),
  )
}

export function download(connection: CriaConnection, path: string): Effect.Effect<Reply<Uint8Array>> {
  return exchange(connection, 'GET', path, undefined).pipe(
    Effect.map(exchanged => {
      if (exchanged.kind === 'lost') return exchanged

      if (exchanged.status === 200) return { kind: 'answered', body: exchanged.bytes }

      return refusal(exchanged.status, new TextDecoder().decode(exchanged.bytes), path)
    }),
  )
}

type Exchanged =
  | { readonly kind: 'responded'; readonly status: number; readonly bytes: Uint8Array }
  | { readonly kind: 'lost'; readonly message: string }

function exchange(
  connection: CriaConnection,
  method: 'GET' | 'POST',
  path: string,
  body: OperationRequest | RecoveryRequest | undefined,
): Effect.Effect<Exchanged> {
  const headers = new Headers()

  if (connection.token !== undefined) headers.set('authorization', `Bearer ${connection.token}`)

  if (body !== undefined) headers.set('content-type', 'application/json')

  const responded = Effect.tryPromise({
    try: async signal => {
      const init: RequestInit = { method, headers, signal }

      if (body !== undefined) init.body = JSON.stringify(body)
      const response = await connection.fetch(new URL(path, connection.origin), init)

      return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()) }
    },
    catch: error => (error instanceof Error ? error.message : String(error)),
  })

  return Effect.timeoutOption(responded, replyWithin).pipe(
    Effect.map((answer): Exchanged =>
      Option.isSome(answer)
        ? { kind: 'responded', ...answer.value }
        : { kind: 'lost', message: `Cria did not answer ${method} ${path} within ${replyWithin}` },
    ),
    Effect.catch(message => Effect.succeed<Exchanged>({ kind: 'lost', message: `Cria did not answer ${method} ${path}: ${message}` })),
  )
}

function decoded<S extends Decodable>(schema: S, text: string, path: string): Reply<S['Type']> {
  const exit = Schema.decodeUnknownExit(Schema.fromJsonString(schema))(text)

  if (Exit.isSuccess(exit)) return { kind: 'answered', body: exit.value }

  return { kind: 'lost', message: `Cria's answer to ${path} is not protocol 5` }
}

function refusal(status: number, text: string, path: string): Reply<never> {
  const exit = Schema.decodeUnknownExit(Schema.fromJsonString(ErrorBody))(text)

  if (Exit.isSuccess(exit)) return { kind: 'refused', code: exit.value.error.code, message: exit.value.error.message }

  return { kind: 'lost', message: `Cria answered ${path} with ${status} and no protocol 5 error` }
}
