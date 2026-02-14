import { URL } from 'url'
import dns from 'dns/promises'
import { config } from '../config'

const VALID_CATEGORIES = ['ai', 'data', 'compute', 'storage', 'analytics', 'other'] as const
type Category = typeof VALID_CATEGORIES[number]

/**
 * SSRF Protection: Validate service endpoint URL
 * Prevents Server-Side Request Forgery attacks
 */
export async function validateServiceEndpoint(endpoint: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const url = new URL(endpoint)
    
    // 1. Protocol validation
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Only HTTP/HTTPS protocols allowed' }
    }
    
    // 2. Require HTTPS in production (allow HTTP localhost in demo mode)
    if (!config.demoMode && url.protocol !== 'https:') {
      return { valid: false, error: 'HTTPS required in production' }
    }
    
    // 3. Block private IP ranges and localhost in production
    const privateIpPatterns = [
      /^127\./,                    // Loopback
      /^10\./,                     // Private class A
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private class B
      /^192\.168\./,               // Private class C
      /^169\.254\./,               // Link-local (AWS metadata)
      /^::1$/,                     // IPv6 loopback
      /^fc00:/,                    // IPv6 private
      /^fe80:/,                    // IPv6 link-local
    ]
    
    // In production, block localhost and private IPs
    if (!config.demoMode) {
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
        return { valid: false, error: 'Localhost not allowed in production' }
      }
      
      if (privateIpPatterns.some(pattern => pattern.test(url.hostname))) {
        return { valid: false, error: 'Private IP addresses not allowed' }
      }
    }
    
    // 4. Block cloud metadata endpoints
    const blockedHosts = [
      '169.254.169.254',           // AWS/Azure metadata
      'metadata.google.internal',  // GCP metadata
      'metadata',
    ]
    
    if (blockedHosts.includes(url.hostname.toLowerCase())) {
      return { valid: false, error: 'Metadata endpoints not allowed' }
    }
    
    // 5. DNS resolution check (prevent DNS rebinding) - only in production
    if (!config.demoMode) {
      try {
        const addresses = await dns.resolve4(url.hostname)
        
        for (const addr of addresses) {
          if (privateIpPatterns.some(pattern => pattern.test(addr))) {
            return { valid: false, error: 'Hostname resolves to private IP' }
          }
        }
      } catch (dnsError) {
        // If DNS resolution fails, block the request in production
        return { valid: false, error: 'Could not resolve hostname' }
      }
    }
    
    // 6. Port restrictions (block common internal services)
    const blockedPorts = [22, 23, 25, 3306, 5432, 6379, 27017] // SSH, Telnet, SMTP, MySQL, PostgreSQL, Redis, MongoDB
    if (url.port && blockedPorts.includes(parseInt(url.port))) {
      return { valid: false, error: 'Port not allowed' }
    }
    
    // 7. URL length check
    if (endpoint.length > 500) {
      return { valid: false, error: 'Endpoint URL too long (max 500 characters)' }
    }
    
    return { valid: true }
  } catch (error) {
    return { valid: false, error: 'Invalid URL' }
  }
}

/**
 * Input Validation: Service Registration
 */
export function validateServiceRegistration(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  // Name validation
  if (!data.name || typeof data.name !== 'string') {
    errors.push('Name is required')
  } else if (data.name.length < 3 || data.name.length > 200) {
    errors.push('Name must be 3-200 characters')
  }
  
  // Description validation
  if (!data.description || typeof data.description !== 'string') {
    errors.push('Description is required')
  } else if (data.description.length < 10 || data.description.length > 2000) {
    errors.push('Description must be 10-2000 characters')
  }
  
  // Category validation
  if (!data.category || !VALID_CATEGORIES.includes(data.category)) {
    errors.push(`Category must be one of: ${VALID_CATEGORIES.join(', ')}`)
  }
  
  // Price validation (satoshis)
  if (!Number.isInteger(data.price)) {
    errors.push('Price must be an integer (satoshis)')
  } else if (data.price < 1) {
    errors.push('Price must be at least 1 satoshi')
  } else if (data.price > 100000000) {
    errors.push('Price cannot exceed 100 million satoshis (1 BSV)')
  }
  
  // Endpoint validation
  if (!data.endpoint || typeof data.endpoint !== 'string') {
    errors.push('Endpoint is required')
  }
  
  // Method validation
  if (!['GET', 'POST'].includes(data.method)) {
    errors.push('Method must be GET or POST')
  }
  
  // Agent ID validation
  if (!data.agentId || typeof data.agentId !== 'string') {
    errors.push('Agent ID is required')
  }
  
  return { valid: errors.length === 0, errors }
}

/**
 * Input Validation: Funding Amount
 */
export function validateFundingAmount(amount: any): { valid: boolean; error?: string } {
  if (!Number.isInteger(amount)) {
    return { valid: false, error: 'Amount must be an integer' }
  }
  
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be positive' }
  }
  
  if (amount > 100000000) { // 1 BSV = 100 million satoshis
    return { valid: false, error: 'Amount cannot exceed 100 million satoshis (1 BSV)' }
  }
  
  return { valid: true }
}

/**
 * Sanitize search query (prevent SQL injection and DoS)
 */
export function sanitizeSearchQuery(query: string): string {
  // Limit length
  query = query.substring(0, 200)
  
  // Remove leading/trailing wildcards to prevent DoS
  query = query.replace(/^%+|%+$/g, '')
  
  // Limit consecutive wildcards
  query = query.replace(/%{2,}/g, '%')
  
  // Remove SQL special characters
  query = query.replace(/[;'"\\]/g, '')
  
  return query.trim()
}
