import { mkdtemp, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MonoFrame } from '@vela/rig-astap'
import { imageIdOf } from '@vela/rig-testing'

export const imageId = imageIdOf(4)

export function frame(overrides: Partial<MonoFrame> = {}): MonoFrame {
  const width = 64
  const height = 48
  const pixels = new Uint16Array(width * height).map((_, index) => (index * 37) % 65_536)

  return { width, height, pixels, capturedAt: '2026-10-26T23:38:36.936Z', capturedAtSource: 'camera', exposureSeconds: 2, color: { kind: 'bayer', pattern: 'rggb' }, ...overrides }
}

export async function workDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rig-astap-test-'))
}

const solvedIni = ['PLTSOLVD=T', 'CRPIX1=32.5', 'CRPIX2=24.5', 'CRVAL1=91.5', 'CRVAL2=10.25', 'CD1_1=-5.2e-06', 'CD1_2=0.000535', 'CD2_1=-0.000535', 'CD2_2=-5.6e-06']

export async function fakeAstap(directory: string, behaviour: { readonly solvesFrom?: number; readonly exit?: number; readonly sleepSeconds?: number }): Promise<{ readonly executable: string; readonly log: string }> {
  const executable = join(directory, 'astap_cli')
  const log = join(directory, 'calls.log')

  const script = [
    '#!/bin/bash',
    `echo "$@" >> "${log}"`,
    ...(behaviour.sleepSeconds ? [`exec sleep ${behaviour.sleepSeconds}`] : []),
    ...(behaviour.exit !== undefined ? [`exit ${behaviour.exit}`] : []),
    'while [ $# -gt 0 ]; do case "$1" in -f) file="$2";; -r) radius="$2";; esac; shift; done',
    `if [ "$radius" -lt ${behaviour.solvesFrom ?? 0} ]; then exit 1; fi`,
    `printf '%s\\n' ${solvedIni.map(line => `'${line}'`).join(' ')} > "\${file%.fits}.ini"`,
    'exit 0',
  ].join('\n')

  await writeFile(executable, script)
  await chmod(executable, 0o755)

  return { executable, log }
}
