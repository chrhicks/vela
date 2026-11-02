/** The mount's driver answered a goto with a refusal, so the mount did not move. */
export class RefusedGotoError extends Error {
  readonly detail: string

  constructor(message: string, detail: string) {
    super(message)
    this.name = 'RefusedGotoError'
    this.detail = detail
  }
}

/** Cria's rejection of a write it sent, when the driver gave no message: "<PROPERTY> on <device>: the driver reported Alert". */
const bareRefusal = /^[A-Z][A-Z0-9_]+ on [^:]+: the driver reported Alert$/

/**
 * Plain words for a goto the driver refused. Cria reports a refusal and an unknown outcome through the same error
 * type, and its unknown-outcome messages come in many shapes. Only the one text a refusal alone produces counts, so
 * "Nothing moved" is never said about a goto that may have moved the mount.
 */
export function refusedGoto(error: Error): RefusedGotoError | undefined {
  if (!bareRefusal.test(error.message)) return undefined

  return new RefusedGotoError('The mount refused the goto. Nothing moved.', error.message)
}
