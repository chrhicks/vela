import { spawn } from 'node:child_process'
import type { Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface SshResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Ssh = (command: string, sink?: Writable) => Promise<SshResult>

export function quote(text: string) {
  return `'${text.replaceAll("'", `'\\''`)}'`
}

export function makeSsh(host: string, timeoutMs: number): Ssh {
  return (command, sink) =>
    new Promise((resolve, reject) => {
      const child = spawn('ssh', ['-o', 'BatchMode=yes', host, command], { stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(timeoutMs) })
      const out: Buffer[] = []
      const err: Buffer[] = []
      const copying = sink === undefined ? undefined : pipeline(child.stdout, sink)

      copying?.catch(() => undefined)
      if (sink === undefined) child.stdout.on('data', (data: Buffer) => out.push(data))
      child.stderr.on('data', (data: Buffer) => err.push(data))
      child.on('error', error => {
        sink?.destroy()
        reject(error)
      })
      child.on('close', code => {
        const done = () => resolve({ code: code ?? -1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') })

        if (copying === undefined) done()
        else copying.then(done, reject)
      })
    })
}
