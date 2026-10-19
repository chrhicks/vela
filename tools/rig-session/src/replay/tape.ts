import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { criaProgram, type CriaCheckout } from './cria-checkout.ts'

const run = promisify(execFile)

/**
 * What `indi-replay synthesize` takes: a made-up recording with tiny frames and a fake site.
 * Scenarios use these and never a real night, so no real coordinates reach this public repository.
 * The fields are the ones of `SynthSpec` in Cria's `packages/indi-replay/src/synthesize.ts`.
 */
export interface TapeSpec {
  camera?: string
  mount?: string
  focuser?: string
  sensor: { width: number; height: number }
  exposureSeconds: number
  /** One entry per frame: how many stars it shows. */
  stars: ReadonlyArray<number>
  site: { latitudeDegrees: number; longitudeDegrees: number }
  startAt: number
  pierSide?: 'east' | 'west'
  pointing: { raHours: number; decDegrees: number }
  tracking?: { from: number; until: number | null }
  gapSeconds?: number
}

/** Writes the recording to `<directory>/tape` with the pinned Cria's `indi-replay synthesize`, and returns that folder. */
export async function synthesizeTape(cria: CriaCheckout, spec: TapeSpec, directory: string): Promise<string> {
  const specFile = join(directory, 'spec.json')
  const tape = join(directory, 'tape')
  const program = criaProgram(cria, 'indi-replay')

  await mkdir(directory, { recursive: true })
  await writeFile(specFile, JSON.stringify(spec))
  await run(program.command, [...program.args, 'synthesize', specFile, tape])

  return tape
}
