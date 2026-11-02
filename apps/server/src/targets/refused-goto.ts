import { CommandNotStartedError, type CommandNotStartedReason } from '@vela/equipment'

/** A goto the mount did not take, in words that say what happened and that nothing moved. */
export class RefusedGotoError extends Error {
  readonly detail: string

  constructor(message: string, detail: string) {
    super(message)
    this.name = 'RefusedGotoError'
    this.detail = detail
  }
}

const unreachable: ReadonlyArray<CommandNotStartedReason> = ['disconnected', 'unavailable']

/** Cria's words without its "<PROPERTY> on <device>: " prefix, unless all it said was that the driver reported Alert. */
function criaText(message: string) {
  const said = /^(?:[A-Z][A-Z0-9_]+ on [^:]+: )?(.+)$/s.exec(message)?.[1]?.trim()

  return said && said !== 'the driver reported Alert' ? said.replace(/[.\s]+$/, '') : undefined
}

export function refusedGoto(error: Error): RefusedGotoError | undefined {
  if (!(error instanceof CommandNotStartedError)) return undefined
  const text = criaText(error.message)

  const plain =
    error.refusal === 'busy'
      ? 'The mount is busy with another operation. Nothing moved.'
      : unreachable.includes(error.refusal)
        ? 'Vela cannot reach the mount. Nothing moved.'
        : 'The mount refused the goto. Nothing moved.'

  return new RefusedGotoError(text ? `${plain} Cria says: ${text}.` : plain, error.message)
}
