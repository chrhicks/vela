import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { openCriaCheckout } from './replay/cria-checkout.ts'
import { startReplayRig } from './replay/replay-rig.ts'

const usage = `Usage (from the Vela repository root; a relative <recording> is taken from there):
  pnpm replay <recording> [--from-frame N] [--name NAME] [--keep]

Runs indi-replay, the pinned Cria and the Vela server on a recording, with every file they write
inside one temporary folder, and prints their addresses. Ctrl+C stops them and removes the folder.
Set CRIA_CHECKOUT to a checkout of chrhicks/cria at the pinned commit (see replay/cria-checkout.ts).`

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    'from-frame': { type: 'string' },
    name: { type: 'string' },
    keep: { type: 'boolean' },
  },
})

if (positionals.length !== 1 || (values['from-frame'] !== undefined && !/^\d+$/.test(values['from-frame']))) {
  console.error(usage)
  process.exit(2)
}

try {
  const cria = await openCriaCheckout(process.env.CRIA_CHECKOUT)
  // pnpm runs this in the package's folder, so a relative path is taken from the Vela repository root.
  const recording = resolve(fileURLToPath(new URL('../../../', import.meta.url)), positionals[0]!)

  const fromFrame = values['from-frame'] === undefined ? undefined : Number(values['from-frame'])
  const rig = await startReplayRig({ recording, cria, name: values.name, fromFrame, keep: values.keep })

  console.log(`${rig.rigName}`)
  console.log(`  Vela API    ${rig.urls.vela}   (the web app: API_PROXY_TARGET=${rig.urls.vela} pnpm dev:web)`)
  console.log(`  Cria        ${rig.urls.cria}`)
  console.log(`  indi-replay ${rig.urls.indiReplay}`)
  console.log(`  Files       ${rig.folder}${values.keep ? ' (kept)' : ' (removed on exit)'}`)
  console.log('Ctrl+C stops everything.')

  let stopping: Promise<void> | undefined

  const stop = () => (stopping ??= rig.stop())

  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void stop().then(() => process.exit(0)))

  const died = await rig.died

  if (!stopping) {
    console.error(`${died} stopped. Logs: ${rig.paths.logs}`)
    process.exitCode = 1
    await stop()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
