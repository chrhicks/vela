import { Exit, Schema } from 'effect'
import { readFile } from 'node:fs/promises'

/** Where a source could not be read, and why. It never carries the offending text: some journals hold the site. */
export interface SourceProblem {
  readonly path: string
  readonly line: number | null
  readonly reason: string
}

export interface JsonlRead<A> {
  readonly rows: readonly { readonly line: number; readonly value: A }[]
  readonly problems: readonly SourceProblem[]
  /** The file ends without a newline: its last line is still being written and was left out. */
  readonly incompleteTail: boolean
}

const decodeErrorCode = Schema.decodeUnknownExit(Schema.Struct({ code: Schema.String }))

/** The errno name of a failed read (`ENOENT`), or `unreadable`. Never the error's message, which can quote a path or content. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A caught error can be anything.
export function reasonOf(error: unknown): string {
  const code = decodeErrorCode(error)

  return Exit.isSuccess(code) ? code.value.code : 'unreadable'
}

export async function readJsonl<A>(path: string, schema: Schema.Decoder<A>): Promise<JsonlRead<A>> {
  const decode = Schema.decodeUnknownExit(schema)
  const rows: { line: number; value: A }[] = []
  const problems: SourceProblem[] = []
  let text: string

  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return { rows, problems: [{ path, line: null, reason: reasonOf(error) }], incompleteTail: false }
  }

  const lines = text.split('\n')
  const tail = lines.pop() ?? ''

  lines.forEach((text, index) => {
    if (text.trim() === '') return

    let raw: unknown

    try {
      raw = JSON.parse(text)
    } catch {
      problems.push({ path, line: index + 1, reason: 'not JSON' })

      return
    }

    const exit = decode(raw)

    if (Exit.isSuccess(exit)) rows.push({ line: index + 1, value: exit.value })
    else problems.push({ path, line: index + 1, reason: 'does not match the schema' })
  })

  return { rows, problems, incompleteTail: tail !== '' }
}
