import { kinds } from '../../packages/rig-events/src/registry.ts'
import { subjectOf } from '../../packages/rig-events/src/ids.ts'

const entries = Object.entries(kinds)

const subjects = predicate => entries.filter(([kind, spec]) => predicate(kind, spec)).map(([kind]) => subjectOf('*', kind))

const facts = subjects((_, spec) => spec.branch === 'fact')

const assessments = subjects((_, spec) => spec.branch === 'assess')

const streams = [
  { name: 'RIG_FACTS', subjects: facts, max_bytes: 20 * 1024 ** 3 },
  { name: 'RIG_ASSESS', subjects: assessments, max_bytes: 2 * 1024 ** 3 },
].map(stream => ({
  ...stream,
  storage: 'file', retention: 'limits', discard: 'old', num_replicas: 1,
  max_age: 14 * 24 * 3600 * 1e9, max_msg_size: 1024 ** 2, duplicate_window: 120 * 1e9,
  deny_delete: true, deny_purge: true, allow_rollup_hdrs: false,
}))

const consumers = [
  { role: 'archiver', stream: 'RIG_FACTS', filters: facts },
  { role: 'archiver', stream: 'RIG_ASSESS', filters: assessments },
  { role: 'solver', stream: 'RIG_FACTS', filters: subjects(kind => kind === 'frame') },
  { role: 'model', stream: 'RIG_FACTS', filters: facts },
].map(({ role, stream, filters }) => ({
  role, stream,
  config: {
    durable_name: `${role}-v1`, name: `${role}-v1`, filter_subjects: filters,
    deliver_policy: 'all', ack_policy: 'explicit', replay_policy: 'instant',
    ack_wait: 30 * 1e9, max_ack_pending: 256, max_waiting: 16,
  },
}))

const producers = { publisher: 'vela', solver: 'solver', model: 'model' }

const permissions = Object.fromEntries(['publisher', 'archiver', 'solver', 'model', 'observer'].map(role => {
  const publish = subjects((_, spec) => spec.producers.includes(producers[role]))

  for (const { stream, config } of consumers.filter(consumer => consumer.role === role)) {
    publish.push(`$JS.API.CONSUMER.INFO.${stream}.${config.name}`)
    publish.push(`$JS.API.CONSUMER.MSG.NEXT.${stream}.${config.name}`)
    publish.push(`$JS.ACK.${stream}.${config.name}.>`)
  }

  return [role, {
    publish: publish.length ? { allow: publish } : { deny: ['>'] },
    subscribe: { allow: [`_INBOX.${role}.>`, ...(role === 'observer' ? assessments : [])] },
  }]
}))

process.stdout.write(JSON.stringify({ streams, consumers, permissions }))
