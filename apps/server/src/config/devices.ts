export interface DeviceConfig {
  rigs: ConfiguredRig[]
}

export interface ConfiguredRig {
  id: string
  name: string
  url: string
}

const deviceConfig: DeviceConfig = {
  rigs: [
    {
      id: 'askar-fra-400',
      name: 'Askar FRA 400',
      url: 'http://192.168.4.104:11111'
    }
  ]
}

export default deviceConfig
