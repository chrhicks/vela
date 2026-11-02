/** The mount's driver answered a goto with a refusal, so the mount did not move. */
export class RefusedGotoError extends Error {
  readonly detail: string

  constructor(message: string, detail: string) {
    super(message)
    this.name = 'RefusedGotoError'
    this.detail = detail
  }
}

/** Cria words a refusal "<PROPERTY> on <device>: <what the driver said>". */
const refusal = /^[A-Z][A-Z0-9_]+ on [^:]+: (.+)$/s

/** A goto whose outcome Cria could not confirm, so the mount may have moved: not a refusal. */
const unconfirmed = /no answer within|went away before answering|connection lost/

const driverSaidNothing = /^the driver reported Alert$/

/**
 * Plain words for a goto the driver refused. Only Cria's refusal shape counts, because Cria reports a refusal and an
 * unknown outcome through the same error type and only the text tells them apart.
 */
export function refusedGoto(error: Error): RefusedGotoError | undefined {
  if (error.name === 'AbortError') return undefined
  const said = refusal.exec(error.message)?.[1]?.trim()

  if (!said || unconfirmed.test(error.message)) return undefined
  const cause = driverSaidNothing.test(said) ? '' : ` Cria says: ${said.replace(/[.\s]+$/, '')}.`

  return new RefusedGotoError(`The mount refused the goto. Nothing moved.${cause}`, error.message)
}
