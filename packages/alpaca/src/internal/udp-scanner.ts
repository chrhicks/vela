import { createSocket as createNodeSocket } from 'node:dgram'
import { networkInterfaces as readNodeNetworkInterfaces } from 'node:os'
import { Schema, SchemaTransformation } from 'effect'
import { AlpacaDiscoveryError } from '../error.js'
import type {
  AlpacaEndpoint,
  AlpacaUdpScanner,
  AlpacaUdpScanRequest,
} from '../discovery-model.js'

const discoveryMessage = new TextEncoder().encode('alpacadiscovery1')
const discoveryPort = 32227
const retryIntervalMs = 250
const discoveryResponse = Schema.Struct({
  AlpacaPort: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
})

const jsonObjectFromString = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, SchemaTransformation.fromJsonString()),
  Schema.decodeTo(Schema.Record(Schema.String, Schema.Unknown)),
)

interface Ipv4Interface {
  readonly address: string
  readonly netmask: string
}

interface UdpSocket {
  onListening(listener: () => void): void
  onMessage(listener: (message: Uint8Array, sourceAddress: string) => void): void
  onError(listener: (error: Error) => void): void
  bind(address: string): void
  setBroadcast(enabled: boolean): void
  send(
    message: Uint8Array,
    port: number,
    address: string,
    callback: (error?: Error) => void,
  ): void
  close(): void
}

export interface UdpScannerDependencies {
  readonly networkInterfaces: () => ReadonlyArray<Ipv4Interface>
  readonly createSocket: () => UdpSocket
}

function signalReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function parseIpv4(address: string): number | undefined {
  const parts = address.split('.')
  if (parts.length !== 4) return undefined

  let value = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined
    value = ((value << 8) | octet) >>> 0
  }
  return value
}

function formatIpv4(value: number): string {
  return [24, 16, 8, 0]
    .map((shift) => String((value >>> shift) & 0xff))
    .join('.')
}

function broadcastAddress(networkInterface: Ipv4Interface): string | undefined {
  const address = parseIpv4(networkInterface.address)
  const netmask = parseIpv4(networkInterface.netmask)
  if (address === undefined || netmask === undefined) return undefined
  return formatIpv4(((address & netmask) | (~netmask >>> 0)) >>> 0)
}

function parseDiscoveryResponse(message: Uint8Array): number | undefined {
  let record: Readonly<Record<string, unknown>>

  try {
    record = Schema.decodeUnknownSync(jsonObjectFromString)(
      new TextDecoder().decode(message).trim(),
    )
  } catch {
    return undefined
  }

  const portEntry = Object.entries(record).find(([name]) => name.toLowerCase() === 'alpacaport')
  if (portEntry === undefined) return undefined

  try {
    const response = Schema.decodeUnknownSync(discoveryResponse)({
      AlpacaPort: portEntry[1],
    })
    return response.AlpacaPort
  } catch {
    return undefined
  }
}

function scanInterface(
  networkInterface: Ipv4Interface,
  options: AlpacaUdpScanRequest,
  createSocket: () => UdpSocket,
): Promise<ReadonlyArray<AlpacaEndpoint>> {
  return new Promise((resolve, reject) => {
    const broadcast = broadcastAddress(networkInterface)
    if (broadcast === undefined) {
      reject(new Error(`Invalid IPv4 interface ${networkInterface.address}`))
      return
    }
    const broadcastTarget = broadcast

    let socket: UdpSocket
    try {
      socket = createSocket()
    } catch (error) {
      reject(error)
      return
    }

    const endpoints = new Map<string, AlpacaEndpoint>()
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let settled = false

    function closeSocket() {
      try {
        socket.close()
      } catch {
        // The socket may fail before binding. There is nothing left to release.
      }
    }

    function cleanUp() {
      for (const timer of timers) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      closeSocket()
    }

    function succeed() {
      if (settled) return
      settled = true
      cleanUp()
      resolve([...endpoints.values()])
    }

    function fail(error: unknown) {
      if (settled) return
      settled = true
      cleanUp()
      reject(error)
    }

    function onAbort() {
      fail(options.signal === undefined ? undefined : signalReason(options.signal))
    }

    function sendDiscovery() {
      if (settled) return
      socket.send(discoveryMessage, discoveryPort, broadcastTarget, (error) => {
        if (error !== undefined) fail(error)
      })
    }

    socket.onMessage((message, sourceAddress) => {
      const port = parseDiscoveryResponse(message)
      if (port === undefined) return
      const endpoint = { host: sourceAddress, port }
      endpoints.set(`${endpoint.host}:${endpoint.port}`, endpoint)
    })
    socket.onError(fail)
    socket.onListening(() => {
      try {
        socket.setBroadcast(true)
      } catch (error) {
        fail(error)
        return
      }

      sendDiscovery()
      for (let attempt = 1; attempt < options.attempts; attempt += 1) {
        timers.push(setTimeout(sendDiscovery, retryIntervalMs * attempt))
      }
      timers.push(setTimeout(succeed, options.durationMs))
    })

    if (options.signal?.aborted) {
      onAbort()
      return
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      socket.bind(networkInterface.address)
    } catch (error) {
      fail(error)
    }
  })
}

export function createUdpScanner({
  networkInterfaces,
  createSocket,
}: UdpScannerDependencies): AlpacaUdpScanner {
  return {
    async scan(options) {
      let availableInterfaces: ReadonlyArray<Ipv4Interface>

      try {
        availableInterfaces = networkInterfaces()
      } catch (cause) {
        throw new AlpacaDiscoveryError('Unable to enumerate IPv4 network interfaces', { cause })
      }

      const selectedAddresses = options.interfaceAddresses === undefined
        ? undefined
        : new Set(options.interfaceAddresses)
      const selectedInterfaces = availableInterfaces.filter((networkInterface) =>
        selectedAddresses === undefined || selectedAddresses.has(networkInterface.address),
      )

      if (selectedInterfaces.length === 0) {
        throw new AlpacaDiscoveryError('No active IPv4 network interfaces are available')
      }

      const results = await Promise.allSettled(
        selectedInterfaces.map((networkInterface) =>
          scanInterface(networkInterface, options, createSocket),
        ),
      )

      if (options.signal?.aborted) {
        throw signalReason(options.signal)
      }

      const successful = results.filter(
        (result): result is PromiseFulfilledResult<ReadonlyArray<AlpacaEndpoint>> =>
          result.status === 'fulfilled',
      )
      if (successful.length === 0) {
        throw new AlpacaDiscoveryError('Alpaca discovery failed on every IPv4 interface', {
          cause: new AggregateError(
            results.map((result) => result.status === 'rejected' ? result.reason : undefined),
          ),
        })
      }

      const endpoints = new Map<string, AlpacaEndpoint>()
      for (const result of successful) {
        for (const endpoint of result.value) {
          endpoints.set(`${endpoint.host}:${endpoint.port}`, endpoint)
        }
      }
      return [...endpoints.values()]
    },
  }
}

function nodeNetworkInterfaces(): ReadonlyArray<Ipv4Interface> {
  const interfaces: Ipv4Interface[] = []

  for (const addresses of Object.values(readNodeNetworkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        interfaces.push({ address: address.address, netmask: address.netmask })
      }
    }
  }

  return [...new Map(
    interfaces.map((networkInterface) => [networkInterface.address, networkInterface]),
  ).values()]
}

function nodeSocket(): UdpSocket {
  const socket = createNodeSocket('udp4')

  return {
    onListening: (listener) => {
      socket.on('listening', listener)
    },
    onMessage: (listener) => {
      socket.on('message', (message, remote) => listener(message, remote.address))
    },
    onError: (listener) => {
      socket.on('error', listener)
    },
    bind: (address) => {
      socket.bind(0, address)
    },
    setBroadcast: (enabled) => {
      socket.setBroadcast(enabled)
    },
    send: (message, port, address, callback) => {
      socket.send(message, port, address, (error) => callback(error ?? undefined))
    },
    close: () => {
      socket.close()
    },
  }
}

export function createNodeUdpScanner(): AlpacaUdpScanner {
  return createUdpScanner({
    networkInterfaces: nodeNetworkInterfaces,
    createSocket: nodeSocket,
  })
}
