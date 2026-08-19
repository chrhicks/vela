import { Schema } from 'effect';
import type { DeviceRig } from '../config/devices.js';
import {
  configuredDevicesResponse,
  connectedResponse,
  descriptionResponse,
  deviceStateResponse,
  type ConfiguredDevice,
  type StateValue,
  driverInfoResponse,
  driverVersionResponse,
  interfaceVersionResponse,
  supportedActionsResponse,
  type ConfiguredDevicesResponse,
} from './types/index.js';

interface AlpacaClient {
  devices(): Promise<ReadonlyArray<ConfiguredDevice>>;
  connected(device: ConfiguredDevice): Promise<boolean>;
  description(device: ConfiguredDevice): Promise<string>;
  deviceState(device: ConfiguredDevice): Promise<ReadonlyArray<StateValue>>;
  driverInfo(device: ConfiguredDevice): Promise<string>;
  driverVersion(device: ConfiguredDevice): Promise<string>;
  interfaceVersion(device: ConfiguredDevice): Promise<number>;
  supportedActions(device: ConfiguredDevice): Promise<ReadonlyArray<string>>;
}

export const createAlpacaClient = (rig: DeviceRig): AlpacaClient => {
  const apiBasePath = '/api/v1'
  const mgmtBasePath = '/management/v1'

  async function request<S extends Schema.ConstraintDecoder<unknown>>(url: string, schema: S): Promise<S["Type"]> {
    console.log(`Requesting ${url}`);
    return fetch(url)
      .then(res => res.json())
      .then((json: unknown) => Schema.decodeUnknownSync(schema)(json));
  }

  return {
    devices: async (): Promise<ConfiguredDevice[]> => {
      const url = `${rig.url}${mgmtBasePath}/configureddevices`;
      const response: ConfiguredDevicesResponse = await request(url, configuredDevicesResponse);
      return response.Value as ConfiguredDevice[];
    },

    connected: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/connected`;
      const response = await request(url, connectedResponse);
      return response.Value;
    },

    description: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/description`;
      const response = await request(url, descriptionResponse);
      return response.Value;
    },

    deviceState: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/devicestate`;
      const response = await request(url, deviceStateResponse);
      return response.Value;
    },

    driverInfo: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/driverinfo`;
      const response = await request(url, driverInfoResponse);
      return response.Value;
    },

    driverVersion: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/driverversion`;
      const response = await request(url, driverVersionResponse);
      return response.Value;
    },

    interfaceVersion: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/interfaceversion`;
      const response = await request(url, interfaceVersionResponse);
      return response.Value;
    },

    supportedActions: async (device: ConfiguredDevice) => {
      const url = `${rig.url}${apiBasePath}/${device.DeviceType.toLowerCase()}/${device.DeviceNumber}/supportedactions`;
      const response = await request(url, supportedActionsResponse);
      return response.Value;
    }
  }
}
