import { readEntry } from './entry.ts'

export const streamName = 'RIG_DEV'

export const clientSubject = 'rig-dev.client'

export const followedSubjects = ['rig-dev.wire.>', clientSubject, 'rig-dev.phd2']

export function makeConnectionFinder() {
  let start: number | undefined

  return {
    take(seq: number, text: string) {
      if (readEntry(text)?.kind === 'client.connected') start = seq
    },

    start() {
      return start
    },
  }
}
