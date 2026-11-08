import type { Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import type { Ssh, SshResult } from '../frames/ssh.ts'

export interface SpoolFile {
  readonly content: Buffer
  readonly modifiedAt: number
}

export interface FakeSpool {
  readonly files: Map<string, SpoolFile>
  readonly commands: string[]
  readonly ssh: Ssh
  corruptNextCopies: number
  failNextCopies: number
  onCopy: (name: string) => void
}

const done = (code: number, stdout = '', stderr = ''): SshResult => ({ code, stdout, stderr })

const quoted = (command: string) => (/'((?:[^']|'\\'')*)'(?: -printf.*)?$/.exec(command)?.[1] ?? '').replaceAll("'\\''", "'")

export function fakeSpool(spoolDir: string): FakeSpool {
  const files = new Map<string, SpoolFile>()
  const commands: string[] = []

  const spool: FakeSpool = {
    files,
    commands,
    corruptNextCopies: 0,
    failNextCopies: 0,
    onCopy: () => {},
    ssh: async (command: string, sink?: Writable) => {
      commands.push(command)

      if (command.startsWith('find ')) {
        const listing = [...files].map(([name, file]) => `${name}\t${file.content.length}\t${file.modifiedAt / 1000}.0000000000\n`).join('')

        return done(0, listing)
      }

      const name = quoted(command).split('/').pop() ?? ''
      const file = files.get(name)

      if (file === undefined) return done(1, '', 'No such file')

      if (command.startsWith('cat ')) {
        spool.onCopy(name)

        if (spool.failNextCopies > 0) {
          spool.failNextCopies -= 1
          sink?.destroy()

          return done(255, '', 'connection lost')
        }

        const bytes = spool.corruptNextCopies > 0 ? Buffer.concat([file.content.subarray(0, file.content.length - 1), Buffer.from([0xff])]) : file.content

        if (spool.corruptNextCopies > 0) spool.corruptNextCopies -= 1
        await new Promise<void>(resolve => sink?.end(bytes, resolve))

        return done(0)
      }

      if (command.startsWith('sha256sum ')) return done(0, `${createHash('sha256').update(file.content).digest('hex')}  ${spoolDir}/${name}\n`)

      return done(127, '', 'unknown command')
    },
  }

  return spool
}
