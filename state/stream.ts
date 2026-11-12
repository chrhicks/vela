import { Schema } from 'effect'

export const Environment = Schema.String.check(Schema.isPattern(/^[a-z]+$/)).pipe(Schema.brand('Environment'))

export type Environment = typeof Environment.Type

export interface Stream {
  readonly name: string
  readonly client: string
  readonly followed: ReadonlyArray<string>
  readonly vela: (family: string) => string
  readonly command: (device: string) => string
  readonly commandDevice: (subject: string) => string | undefined
}

export function streamOf(environment: Environment): Stream {
  const prefix = `rig-${environment}`
  const commandPrefix = `${prefix}.command.`

  return {
    name: `RIG_${environment.toUpperCase()}`,
    client: `${prefix}.client`,
    followed: [`${prefix}.wire.>`, `${prefix}.client`, `${prefix}.phd2`, `${prefix}.vela.>`, `${commandPrefix}>`],
    vela: family => `${prefix}.vela.${family}`,
    command: device => `${commandPrefix}${device}`,
    commandDevice: subject => (subject.startsWith(commandPrefix) ? subject.slice(commandPrefix.length) : undefined),
  }
}
