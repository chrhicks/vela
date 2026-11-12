import { Result } from 'effect'
import type { Entry, Message, UnreadableMessage } from '../../state/entry.ts'

export function makeConnectionFinder(read: (message: Message) => Result.Result<Entry, UnreadableMessage>) {
  let start: number | undefined

  return {
    take(message: Message) {
      if (Result.getOrUndefined(read(message))?.kind === 'client.connected') start = message.seq
    },

    start() {
      return start
    },
  }
}
