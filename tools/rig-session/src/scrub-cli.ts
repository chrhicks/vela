import { scrubRepository } from './scrub-repository.ts'

const root = process.argv[2] ?? process.cwd()

const { scanned, findings, staleExceptions } = scrubRepository(root)

for (const finding of findings) console.log(`${finding.path}:${finding.line}  ${finding.rule}`)

for (const stale of staleExceptions) console.log(`stale exception: ${stale}`)

console.log(`Scrubbed ${scanned.length} committed fixtures under ${root}: ${findings.length} findings, ${staleExceptions.length} stale exceptions`)

process.exitCode = findings.length || staleExceptions.length ? 1 : 0
