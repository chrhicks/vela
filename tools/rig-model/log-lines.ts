import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

async function logFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = []

  for (const path of paths) {
    if ((await stat(path)).isDirectory()) files.push(...(await readdir(path)).filter(name => /^run-.+\.jsonl$/.test(name)).toSorted().map(name => join(path, name)))
    else files.push(path)
  }

  return files
}

/**
 * Every line of Vela's Cria logs, in the order given. A directory is a run log (`docs/run-log.md`): its `run-*.jsonl`
 * files in name order, which is time order. Any other path is one file, a run-log file or an old Cria journal; the
 * lines say which, to `createLogReader`.
 */
export async function* logLines(paths: readonly string[]): AsyncGenerator<string> {
  for (const path of await logFiles(paths)) yield* createInterface({ input: createReadStream(path), crlfDelay: Infinity })
}
