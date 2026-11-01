const readSide = new Set([
  'Availability',
  'BindingId',
  'CameraReadings',
  'Device',
  'DeviceBody',
  'DeviceId',
  'DeviceKind',
  'FailureDomain',
  'FocuserReadings',
  'Image',
  'ImageId',
  'InstanceId',
  'Json',
  'MountReadings',
  'Operation',
  'OperationId',
  'OperationResult',
  'Outcome',
  'Progress',
  'Quarantine',
  'ReadingsOf',
  'Reading',
  'RequestId',
  'State',
  'SwitchChannel',
  'SwitchReadings',
  'Timestamp',
  'WeatherReadings',
  'availabilityReasons',
  'coordinateFrames',
  'deviceKinds',
  'protocolVersion',
])

const reexport = /^export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@cria\/wire'\s*$/

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function exportedNames(list: string): string[] {
  return list
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .map(entry => entry.replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '')
}

/** The gateway is a list of read-side re-exports and nothing else, so no rig code can name a Cria command. */
export function gatewayProblems(source: string): string[] {
  const problems: string[] = []

  const statements = withoutComments(source)
    .split(/;|\n(?=export|import)/)
    .map(statement => statement.trim())
    .filter(statement => statement !== '')

  for (const statement of statements) {
    const match = reexport.exec(statement.replace(/\s+/g, ' '))

    if (!match) {
      problems.push(`not a read-side re-export: ${statement.slice(0, 60)}`)
      continue
    }

    for (const name of exportedNames(match[1] ?? ''))
      if (!readSide.has(name)) problems.push(`'${name}' is not on the read-side allowlist`)
  }

  return problems
}
