import net from 'net'
import dns from 'dns/promises'
import { config } from '../config'

export function isPrivateIp(ip: string): boolean {
  const ipVersion = net.isIP(ip)
  if (ipVersion === 4) {
    const parts = ip.split('.').map((p) => Number(p))
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false
    const [a, b] = parts
    if (a === 10) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }

  if (ipVersion === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA fc00::/7
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.replace('::ffff:', '')
      return isPrivateIp(mapped)
    }
  }

  return false
}

function isDisallowedLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.localdomain') ||
    host.endsWith('.internal')
  )
}

export function validateWebhookUrl(urlText: string): void {
  let u: URL
  try {
    u = new URL(urlText)
  } catch {
    throw new Error('Invalid webhook URL')
  }

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error('Webhook URL must be http or https')
  }

  if (u.username || u.password) {
    throw new Error('Webhook URL must not include credentials')
  }

  if (config.demoMode) return

  const host = u.hostname.toLowerCase()
  if (isDisallowedLocalHostname(host)) throw new Error('Webhook host not allowed')

  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Webhook IP not allowed')
  }
}

export async function assertResolvesToPublicIp(hostname: string): Promise<void> {
  if (config.demoMode) return

  const host = hostname.trim().toLowerCase()
  if (!host) throw new Error('Webhook host is required')
  if (isDisallowedLocalHostname(host)) throw new Error('Webhook host not allowed')

  // Literal IP hostnames can be evaluated directly.
  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Webhook target resolves to private network address')
  }

  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    throw new Error('Webhook host could not be resolved')
  }

  if (!addresses.length) throw new Error('Webhook host could not be resolved')

  for (const entry of addresses) {
    if (isPrivateIp(entry.address)) {
      throw new Error('Webhook target resolves to private network address')
    }
  }
}

export function validateServiceEndpoint(endpoint: string) {
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    throw new Error('Invalid endpoint URL')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Endpoint must be http(s)')

  // In demo mode, allow localhost and any port for testing
  if (config.demoMode) return

  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0') throw new Error('Endpoint host not allowed')
  if (host === '169.254.169.254') throw new Error('Endpoint host not allowed')

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Endpoint IP not allowed')
  }

  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  if (![80, 443].includes(port)) throw new Error('Endpoint port not allowed')
}
