import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogReader, epochMs, rigId, sourceId, type RigEvent, type RigId } from '@vela/rig-events'
import { assess, createModel, defaultConfig, step, type Assessment, type RigModel } from '@vela/rig-model'
import type { RunLog } from '../run-log/run-log.js'

const modelSource = sourceId('vela:model')

export function createModelHost(directory?: string, now = Date.now) {
  const models = new Map<RigId, RigModel>()
  const pending: RigEvent[] = []
  let state: 'restoring' | 'ready' | 'failed' | 'closed' = 'restoring'
  let timer: NodeJS.Timeout | undefined

  function accept(event: RigEvent) {
    const model = models.get(event.rig) ?? createModel(defaultConfig(event.rig, modelSource))

    models.set(event.rig, step(model, event).model)
  }

  async function restore() {
    if (directory) {
      const names = await readdir(directory).catch(error => {
        if (error.code === 'ENOENT') return []
        throw error
      })

      const reader = createLogReader({ rig: rigId('legacy'), source: sourceId('vela:cria') })
      const seen = new Set<string>()

      for (const name of names.filter(name => name.endsWith('.jsonl')).sort()) {
        let tail = ''

        for await (const chunk of createReadStream(join(directory, name), { encoding: 'utf8' })) {
          if (state === 'closed') return
          const lines = (tail + chunk).split('\n')

          tail = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.trim()) continue
            const decoded = reader.read(line)

            if (!decoded.ok) throw new Error(`Cannot restore rig model from ${name}: invalid log line`)

            if (seen.has(decoded.event.id)) continue
            seen.add(decoded.event.id)
            accept(decoded.event)
          }
        }
      }
    }

    if (state === 'closed') return
    const at = epochMs(now())

    for (const [rig, model] of models) models.set(rig, step(model, { kind: 'vela-restarted', at }).model)

    for (const event of pending) accept(event)
    pending.length = 0
    state = 'ready'
    timer = setInterval(() => {
      const at = epochMs(now())

      for (const [rig, model] of models) models.set(rig, step(model, { kind: 'clock', at }).model)
    }, 1000)
    timer.unref()
  }

  const ready = restore().catch(error => {
    state = 'failed'
    pending.length = 0
    throw error
  })

  return {
    ready,
    get(rig: string): Assessment | null {
      if (state !== 'ready') return null
      const model = models.get(rigId(rig))

      return model ? structuredClone(assess(model)) : null
    },
    onAppend(event: RigEvent) {
      if (state === 'restoring') pending.push(event)
      else if (state === 'ready') accept(event)
    },
    close() {
      state = 'closed'
      pending.length = 0
      clearInterval(timer)
    },
  }
}

export type ModelHost = ReturnType<typeof createModelHost>

export function modelRunLog(log: RunLog, host: ModelHost): RunLog {
  return {
    append(event) {
      log.append(event)
      host.onAppend(event)
    },
    health: () => log.health(),
    close: () => log.close(),
  }
}
