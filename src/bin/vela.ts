import { readConfig } from '../config.ts'
import { makeNight } from '../rig/night.ts'
import { makePicture } from '../rig/picture.ts'
import { makePage } from '../page/server.ts'
import { VelaSettings } from '../settings.ts'
import { brokerSettings } from '../stream/broker.ts'
import { readEntry } from '../stream/entry.ts'
import { followRig } from '../stream/follow.ts'

const settings = readConfig(VelaSettings, process.argv[2])
const picture = makePicture()

function lost(reason: string): never {
  console.error(`vela: ${reason}`)
  process.exit(1)
}

const following = await followRig({
  broker: brokerSettings(settings.broker),
  readBatch: settings.historyReadBatch,
  onMessage: message => {
    const entry = readEntry(message.text)

    if (entry !== undefined) picture.apply(entry, Date.now())
  },
  onCaughtUp: () => picture.caughtUp(),
})

void following.connection.closed().then(error => lost(`broker connection lost${error ? `: ${error.message}` : ''}`))
following.done.then(
  () => lost('the stream reader ended'),
  (error: unknown) => lost(`the stream reader failed: ${String(error)}`),
)

const nightSettings = { devices: settings.devices, silenceMs: settings.silenceSeconds * 1000 }

makePage({ night: () => makeNight(picture, nightSettings, Date.now()), refreshMs: settings.pageRefreshSeconds * 1000 }).listen(settings.port, '127.0.0.1', () =>
  console.error(`vela: http://127.0.0.1:${settings.port}/`),
)
