import { epochMs, seal, sourceId, type RigEvent } from '@vela/rig-events'
import type { AutofocusRun } from '@vela/model/web'
import { frameRigId } from '../capture/frame-records.js'
import type { RunLog } from '../run-log/run-log.js'

export interface AutofocusRecords {
  /** Returns at once and never throws. */
  append(run: AutofocusRun): void
}

export const noAutofocusRecords: AutofocusRecords = { append() {} }

const autofocusSource = sourceId('vela:autofocus')

function autofocusEvent({ version: _version, rigId, ...body }: AutofocusRun): RigEvent {
  const at = epochMs(Date.parse(body.settledAt ?? body.startedAt))

  return seal({ rig: frameRigId(rigId), source: autofocusSource, kind: 'autofocus', at, seenAt: at, body })
}

/** Files each settled autofocus run in the run log as an `autofocus` event. A record is never the reason a walk stops. */
export function autofocusRecordsOn(log: Pick<RunLog, 'append'>): AutofocusRecords {
  return {
    append(run) {
      try {
        log.append(autofocusEvent(run))
      } catch (error) {
        console.error('Vela autofocus records:', error instanceof Error ? error.message : String(error))
      }
    },
  }
}
