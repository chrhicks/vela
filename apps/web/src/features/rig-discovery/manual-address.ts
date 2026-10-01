/** The browser's immediate feedback matches the server's hostname/IPv4 boundary. */
export function isDiscoveryHost(host: string): boolean {
  if (host.length === 0 || host.length > 253 || host !== host.trim()) return false

  const octets = host.split('.')

  const ipv4 =
    octets.length === 4 &&
    octets.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)

  if (ipv4) return true

  if (host.includes('.') && /^[0-9.]+$/.test(host)) return false

  const withoutTrailingDot = host.endsWith('.') ? host.slice(0, -1) : host

  if (withoutTrailingDot.length === 0) return false

  return withoutTrailingDot
    .split('.')
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}
