export type Role = 'vela' | 'cria' | 'solver' | 'model' | 'operator'

export type Branch = 'fact' | 'assess'

interface KindSpec {
  readonly branch: Branch
  readonly producers: readonly Role[]
}

export const kinds = {
  'cria.state': { branch: 'fact', producers: ['vela'] },
  'cria.exchange': { branch: 'fact', producers: ['vela'] },
  'cria.image': { branch: 'fact', producers: ['vela'] },
  'cria.stream': { branch: 'fact', producers: ['vela'] },
  frame: { branch: 'fact', producers: ['vela'] },
  solve: { branch: 'fact', producers: ['solver'] },
  session: { branch: 'fact', producers: ['operator'] },
  gap: { branch: 'fact', producers: ['vela', 'cria', 'solver'] },
  'mount-position': { branch: 'assess', producers: ['model'] },
  'pointing-fix': { branch: 'assess', producers: ['model'] },
} as const satisfies Record<string, KindSpec>

export type Kind = keyof typeof kinds

export type KindsOf<B extends Branch> = { [K in Kind]: (typeof kinds)[K]['branch'] extends B ? K : never }[Kind]

export type FactKind = KindsOf<'fact'>

export type AssessKind = KindsOf<'assess'>

export type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
