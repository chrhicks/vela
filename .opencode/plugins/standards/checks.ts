// Stable diagnostic IDs point to the owning document, not a second rule catalog.
export const standards = {
  readability: 'Readability',
  formatting: 'Formatting',
  types_boundaries: 'Types and boundaries',
  modules: 'Modules, capabilities, and dependencies',
  state_persistence: 'State and persistence',
  comments: 'Comments and durable documentation',
  error_context: 'Errors, retries, and device commands',
  tests: 'Tests',
  frontend: 'Frontend and UI',
  trust_boundaries: 'Trust boundaries',
} as const

export type StandardId = keyof typeof standards
