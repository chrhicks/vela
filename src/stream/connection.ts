import { Match, Result } from 'effect'
import type { Entry, Message, UnreadableMessage } from '../../state/entry.ts'

export function makeConnectionFinder(read: (message: Message) => Result.Result<Entry, UnreadableMessage>, onUnreadable: (error: UnreadableMessage) => void) {
  let start: number | undefined

  return {
    take(message: Message) {
      Result.match(read(message), {
        onSuccess: entry => {
          if (entry.kind === 'client.connected') start = message.seq
        },
        onFailure: error => Match.valueTags(error, { UnreadableMessage: onUnreadable }),
      })
    },

    start() {
      return start
    },
  }
}
