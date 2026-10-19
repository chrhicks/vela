import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { createServer, type AddressInfo } from 'node:net'

export interface Service {
  readonly name: string
  /** What the service has printed so far, the newest 16 KiB. */
  output(): string
  /** Resolves when the process ends, however it ends. */
  readonly exited: Promise<void>
  /** Sends SIGTERM, then SIGKILL after `graceMs`. Resolves once the process has exited. */
  stop(graceMs?: number): Promise<void>
}

export interface ServiceOptions {
  name: string
  command: string
  args: ReadonlyArray<string>
  env: NodeJS.ProcessEnv
  cwd: string
  /** The service's output is appended here. */
  logFile: string
  /** A capture group of this pattern, found in the output, is the service's address; the service is up. */
  ready: RegExp
  timeoutMs?: number
}

const tailBytes = 16 * 1024

/** Starts a program and waits for it to print `ready`. Rejects with its output if it exits first. */
export async function startService(options: ServiceOptions): Promise<{ service: Service; match: string }> {
  const { name, command, args, env, cwd, logFile, ready, timeoutMs = 60_000 } = options
  const child = spawn(command, [...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = createWriteStream(logFile, { flags: 'a' })
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()))
  let output = ''

  const take = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-tailBytes)
    log.write(chunk)
  }

  child.stdout.on('data', take)
  child.stderr.on('data', take)

  const service: Service = {
    name,
    output: () => output,
    exited,
    async stop(graceMs = 10_000) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        const killer = setTimeout(() => child.kill('SIGKILL'), graceMs)

        await exited
        clearTimeout(killer)
      }

      await new Promise<void>(resolve => log.end(resolve))
    },
  }

  try {
    const match = await waitForOutput(child, name, () => output, ready, timeoutMs)

    return { service, match }
  } catch (error) {
    await service.stop(2000)
    throw error
  }
}

function waitForOutput(
  child: ChildProcess,
  name: string,
  output: () => string,
  ready: RegExp,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearInterval(poll)
      clearTimeout(timeout)
      child.off('close', onClose)
    }

    const failed = (why: string) => {
      finish()
      reject(new Error(`${name} ${why}. Its output:\n${output()}`))
    }

    const onClose = (code: number | null) => failed(`exited with ${code} before it was ready`)

    const poll = setInterval(() => {
      const found = ready.exec(output())?.[1]

      if (found === undefined) return
      finish()
      resolve(found)
    }, 50)

    const timeout = setTimeout(() => failed(`did not become ready in ${timeoutMs} ms`), timeoutMs)

    child.once('close', onClose)
  })
}

/** A port nothing is listening on right now. Another process could take it before it is used. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      // SAFETY: listen(0, host) binds a TCP socket, whose address is an AddressInfo.
      const { port } = server.address() as AddressInfo

      server.close(() => resolve(port))
    })
  })
}
