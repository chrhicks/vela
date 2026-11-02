import { readFile, realpath } from 'node:fs/promises'
import { relative, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from '@nats-io/transport-node'
import { jetstream } from '@nats-io/jetstream'
import { astapVersion, createAstapSolver, judgeSolve, readFitsCards, solveFile, type AstapConfig } from '@vela/rig-astap'
import { decodeLine, encodeEvent, epochMs, seal, sourceId, subjectOf, type Envelope, type SolveResultBody } from '@vela/rig-events'
import { z } from 'zod'

export interface ShadowOptions {
  readonly url: string
  readonly credentialsFile: string
  readonly imagesDirectory: string
  readonly astap: AstapConfig
  readonly signal: AbortSignal
}

export async function solveSavedFrame(event: Envelope<'frame'>, options: Pick<ShadowOptions, 'imagesDirectory' | 'astap' | 'signal'>, solverVersion: string): Promise<SolveResultBody | null> {
  const frame = event.body
  const image = frame.image

  if (frame.frameType !== 'light' || frame.outcome !== 'saved') return null

  if (!image?.ref) throw new Error('Saved light frame has no image reference')

  const root = await realpath(options.imagesDirectory)
  const path = resolve(fileURLToPath(image.ref.uri))

  const withinRoot = (candidate: string) => {
    const part = relative(root, candidate)

    return part !== '..' && !part.startsWith('../') && !isAbsolute(part)
  }

  if (!withinRoot(path)) throw new Error('Frame outside saved images')

  const actual = await realpath(path).catch(() => path)

  if (!withinRoot(actual)) throw new Error('Frame symlink outside saved images')

  const bytes = await readFile(actual).catch(() => undefined)
  const cards = bytes ? readFitsCards(bytes) : new Map<string, string>()

  const position = z.object({ raDegrees: z.coerce.number().min(0).lt(360), decDegrees: z.coerce.number().min(-90).max(90) })
    .safeParse({ raDegrees: cards.get('RA'), decDegrees: cards.get('DEC') })

  const claimed = position.success ? position.data : null
  const purpose = frame.origin === 'alignment-trial' ? 'alignment' : 'framing'

  const solve = await solveFile(createAstapSolver(options.astap), {
    imageId: image.id, hint: claimed ?? { raDegrees: 0, decDegrees: 0 }, solverVersion,
  }, actual, options.signal)

  const solution = solve.status === 'solved' ? solve : { status: 'no-solution' as const, reason: solve.reason === 'too-few-stars' ? 'too-few-stars' as const : 'no-match' as const }

  const verdict = judgeSolve({ solution, stars: null, claimed }, {
    arcsecPerPixel: options.astap.fieldHeightDegrees * 3600 / image.height, parity: 1,
  }, purpose)

  return { frameEventId: event.id, purpose, solve, verdict }
}

export async function runShadowSolver(options: ShadowOptions) {
  const { solver } = z.object({ solver: z.string().min(1) }).parse(JSON.parse(await readFile(options.credentialsFile, 'utf8')))
  const solverVersion = await astapVersion(options.astap.executable)
  const connection = await connect({ servers: options.url, user: 'solver', pass: solver, inboxPrefix: '_INBOX.solver', reconnect: false })
  const client = jetstream(connection)
  const stop = () => { void connection.close() }

  options.signal.addEventListener('abort', stop, { once: true })

  try {
    const consumer = await client.consumers.get('RIG_FACTS', 'solver-v1')

    while (!options.signal.aborted) {
      const message = await consumer.next({ expires: 1000 })

      if (!message) continue

      const decoded = decodeLine(message.string())

      if (!decoded.ok || decoded.event.kind !== 'frame') throw new Error('Invalid frame envelope')

      const frame = decoded.event
      const heartbeat = setInterval(() => message.working(), 10_000)

      try {
        const body = await solveSavedFrame(frame, options, solverVersion)

        if (body) {
          const event = seal({ kind: 'solve-result', rig: frame.rig, source: sourceId('solver:shadow-v1'),
            at: frame.at, seenAt: epochMs(Date.now()), body })

          await client.publish(subjectOf(event.rig, event.kind), Buffer.from(encodeEvent(event)), { msgID: event.id, retries: 1 })
        }

        message.ack()
        await connection.flush()
      } finally {
        clearInterval(heartbeat)
      }
    }
  } finally {
    options.signal.removeEventListener('abort', stop)
    await connection.close()
  }
}
