import { readMessage, type Message } from '../../state/entry.ts'

export const streamName = 'RIG_DEV'

export const clientSubject = 'rig-dev.client'

export const followedSubjects = ['rig-dev.wire.>', clientSubject, 'rig-dev.phd2', 'rig-dev.vela.>', 'rig-dev.command.>']

export function makeConnectionFinder() {
  let start: number | undefined

  return {
    take(message: Message) {
      if (readMessage(message)?.kind === 'client.connected') start = message.seq
    },

    start() {
      return start
    },
  }
}
