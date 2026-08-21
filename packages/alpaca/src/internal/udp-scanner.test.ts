import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlpacaDiscoveryError } from '../error.js'
import { createUdpScanner } from './udp-scanner.js'

class FakeSocket {
  readonly sends: Array<{ message: string, port: number, address: string }> = []
  boundAddress?: string
  broadcastEnabled = false
  closed = false
  failBind = false
  onSend?: (socket: FakeSocket) => void

  private listeningListener: () => void = () => undefined
  private messageListener: (message: Uint8Array, sourceAddress: string) => void = () => undefined
  private errorListener: (error: Error) => void = () => undefined

  onListening(listener: () => void) {
    this.listeningListener = listener
  }

  onMessage(listener: (message: Uint8Array, sourceAddress: string) => void) {
    this.messageListener = listener
  }

  onError(listener: (error: Error) => void) {
    this.errorListener = listener
  }

  bind(address: string) {
    this.boundAddress = address
    if (this.failBind) throw new Error(`Cannot bind ${address}`)
    queueMicrotask(() => this.listeningListener())
  }

  setBroadcast(enabled: boolean) {
    this.broadcastEnabled = enabled
  }

  send(
    message: Uint8Array,
    port: number,
    address: string,
    callback: (error?: Error) => void,
  ) {
    this.sends.push({
      message: new TextDecoder().decode(message),
      port,
      address,
    })
    callback()
    this.onSend?.(this)
  }

  close() {
    this.closed = true
  }

  emitMessage(value: string, sourceAddress: string) {
    this.messageListener(new TextEncoder().encode(value), sourceAddress)
  }

  emitError(error: Error) {
    this.errorListener(error)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('IPv4 UDP scanner', () => {
  it('scans every interface, retries, ignores malformed packets, and de-duplicates endpoints', async () => {
    vi.useFakeTimers()
    const sockets = [new FakeSocket(), new FakeSocket()]
    for (const socket of sockets) {
      socket.onSend = (activeSocket) => {
        activeSocket.emitMessage('not json', '192.168.4.104')
        activeSocket.emitMessage('[]', '192.168.4.104')
        activeSocket.emitMessage('null', '192.168.4.104')
        activeSocket.emitMessage('{"AlpacaPort":70000}', '192.168.4.104')
        activeSocket.emitMessage('{"alpacaport":11111}', '192.168.4.104')
      }
    }
    let socketIndex = 0
    const scanner = createUdpScanner({
      networkInterfaces: () => [
        { address: '192.168.4.2', netmask: '255.255.255.0' },
        { address: '10.0.0.2', netmask: '255.255.0.0' },
      ],
      createSocket: () => sockets[socketIndex++]!,
    })

    const scan = scanner.scan({ durationMs: 1_000, attempts: 2 })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(scan).resolves.toEqual([
      { host: '192.168.4.104', port: 11111 },
    ])
    expect(sockets[0]!.boundAddress).toBe('192.168.4.2')
    expect(sockets[1]!.boundAddress).toBe('10.0.0.2')
    expect(sockets[0]!.sends).toEqual([
      { message: 'alpacadiscovery1', port: 32227, address: '192.168.4.255' },
      { message: 'alpacadiscovery1', port: 32227, address: '192.168.4.255' },
    ])
    expect(sockets[1]!.sends[0]!.address).toBe('10.0.255.255')
    expect(sockets.every((socket) => socket.broadcastEnabled && socket.closed)).toBe(true)
  })

  it('continues when one interface fails', async () => {
    vi.useFakeTimers()
    const failedSocket = new FakeSocket()
    failedSocket.failBind = true
    const goodSocket = new FakeSocket()
    const sockets = [failedSocket, goodSocket]
    let socketIndex = 0
    const scanner = createUdpScanner({
      networkInterfaces: () => [
        { address: '192.168.4.2', netmask: '255.255.255.0' },
        { address: '10.0.0.2', netmask: '255.255.255.0' },
      ],
      createSocket: () => sockets[socketIndex++]!,
    })

    const scan = scanner.scan({ durationMs: 1_000, attempts: 1 })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(scan).resolves.toEqual([])
    expect(failedSocket.closed).toBe(true)
    expect(goodSocket.closed).toBe(true)
  })

  it('throws a structured error when every interface fails', async () => {
    const socket = new FakeSocket()
    socket.failBind = true
    const scanner = createUdpScanner({
      networkInterfaces: () => [
        { address: '192.168.4.2', netmask: '255.255.255.0' },
      ],
      createSocket: () => socket,
    })

    await expect(scanner.scan({ durationMs: 1_000, attempts: 1 })).rejects.toBeInstanceOf(
      AlpacaDiscoveryError,
    )
  })

  it('supports selecting interfaces explicitly', async () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const scanner = createUdpScanner({
      networkInterfaces: () => [
        { address: '192.168.4.2', netmask: '255.255.255.0' },
        { address: '10.0.0.2', netmask: '255.255.255.0' },
      ],
      createSocket: () => socket,
    })

    const scan = scanner.scan({
      durationMs: 1_000,
      attempts: 1,
      interfaceAddresses: ['10.0.0.2'],
    })
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(scan).resolves.toEqual([])
    expect(socket.boundAddress).toBe('10.0.0.2')
  })

  it('closes sockets immediately when cancelled', async () => {
    const socket = new FakeSocket()
    const controller = new AbortController()
    const cancellation = new Error('scan cancelled')
    const scanner = createUdpScanner({
      networkInterfaces: () => [
        { address: '192.168.4.2', netmask: '255.255.255.0' },
      ],
      createSocket: () => socket,
    })

    const scan = scanner.scan({
      durationMs: 1_000,
      attempts: 2,
      signal: controller.signal,
    })
    await Promise.resolve()
    controller.abort(cancellation)

    await expect(scan).rejects.toBe(cancellation)
    expect(socket.closed).toBe(true)
  })
})
