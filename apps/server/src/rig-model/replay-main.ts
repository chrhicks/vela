import { z } from 'zod'
import { compareModelReplay } from './replay.js'

const [directory, from, to] = z.tuple([z.string().min(1), z.coerce.number().finite(), z.coerce.number().finite()]).parse(process.argv.slice(2))

const result = await compareModelReplay(directory, { from, to })

process.stdout.write(JSON.stringify(result) + '\n')

if (!result.equal) process.exitCode = 1
