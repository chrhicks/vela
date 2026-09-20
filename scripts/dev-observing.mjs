import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

try {
  process.loadEnvFile(resolve(root, '.env.observing.local'))

  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '3001',
    API_PROXY_TARGET: 'http://127.0.0.1:3001',
    VELA_LAN_HOST: process.env.VELA_LAN_HOST || 'polaris.local',
    VELA_RIG_CATALOG_PATH: resolve(root, process.env.VELA_RIG_CATALOG_PATH || 'data/rigs.yaml'),
    VELA_SAVED_IMAGES_PATH: resolve(root, process.env.VELA_SAVED_IMAGES_PATH || 'data/saved-images'),
  }

  for (const key of ['VELA_ASTAP', 'VELA_STAR_CATALOG']) {
    if (!env[key]) throw new Error(`Set ${key} in .env.observing.local`)
    env[key] = resolve(root, env[key])
    await access(env[key], key === 'VELA_ASTAP' ? constants.X_OK : constants.R_OK)
  }

  if (env.VELA_ALIGNMENT_DIAGNOSTICS_PATH) {
    env.VELA_ALIGNMENT_DIAGNOSTICS_PATH = resolve(root, env.VELA_ALIGNMENT_DIAGNOSTICS_PATH)
  }

  await available(3001, '127.0.0.1')
  await available(5173, '0.0.0.0')
  console.log(`Starting Vela for http://${env.VELA_LAN_HOST}:5173 — Ctrl+C stops this run.`)
  // A separate process group lets this command stop pnpm and all its watchers.
  const child = spawn('pnpm', ['dev'], { cwd: root, env, stdio: 'inherit', detached: true })

  const stop = signal => {
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }

  process.on('SIGINT', () => stop('SIGINT'))
  process.on('SIGTERM', () => stop('SIGTERM'))
  child.on('error', error => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    stop('SIGTERM')
    process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1)
  })
} catch (error) {
  console.error(`Could not start observing: ${error.message}`)
  console.error('Local configuration: .env.observing.local (see .env.observing.example).')
  process.exitCode = 1
}

function available(port, host) {
  return new Promise((resolveReady, reject) => {
    const server = createServer()
    server.once('error', error => reject(new Error(`Port ${port} is unavailable (${error.code}). Stop the existing server first.`)))
    server.listen({ port, host }, () => server.close(resolveReady))
  })
}
