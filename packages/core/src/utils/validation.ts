import net from 'net'

export function isPrivateIp(ip: string): boolean {
  // IPv4 only (sufficient for audit scenarios)
  const parts = ip.split('.').map(p => Number(p))
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return false
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function validateServiceEndpoint(endpoint: string) {
  let u: URL
  try {
    u = new URL(endpoint)
  } catch {
    throw new Error('Invalid endpoint URL')
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Endpoint must be http(s)')

  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host === '0.0.0.0') throw new Error('Endpoint host not allowed')
  if (host === '169.254.169.254') throw new Error('Endpoint host not allowed')

  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Endpoint IP not allowed')
  }

  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80
  if (![80, 443].includes(port)) throw new Error('Endpoint port not allowed')
}
