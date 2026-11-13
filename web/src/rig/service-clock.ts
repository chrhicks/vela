import type { Link } from './store.ts'

export const serviceNow = (link: Link, localNow: number) => (link.beat === undefined ? undefined : link.beat.at + (localNow - link.beat.receivedAt))
