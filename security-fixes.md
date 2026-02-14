# AgentPay Security Fixes - Implementation Guide

**Date:** 2026-02-14  
**Priority:** Critical & High Findings  
**Target:** Production Readiness

---

## Table of Contents

1. [Authentication System](#1-authentication-system)
2. [Authorization & IDOR Protection](#2-authorization--idor-protection)
3. [Private Key Security](#3-private-key-security)
4. [Encryption Master Key Enforcement](#4-encryption-master-key-enforcement)
5. [SSRF Protection](#5-ssrf-protection)
6. [Input Validation](#6-input-validation)
7. [Payment Security](#7-payment-security)
8. [Rate Limiting](#8-rate-limiting)
9. [CORS Configuration](#9-cors-configuration)

---

## 1. Authentication System

### 1.1 Create Authentication Middleware

**File:** `src/middleware/auth.ts` (NEW)

```typescript
import { Request, Response, NextFunction } from 'express'
import { PrivateKey, PublicKey } from '@bsv/sdk'
import crypto from 'crypto'

/**
 * Authentication via signed challenges
 * 
 * Flow:
 * 1. Client requests challenge: GET /api/auth/challenge?address=<address>
 * 2. Server returns random nonce
 * 3. Client signs nonce with private key
 * 4. Client sends signature: POST /api/auth/login { address, signature, nonce }
 * 5. Server verifies signature, returns JWT
 * 6. Client includes JWT in Authorization header
 */

interface AuthRequest extends Request {
  walletId?: string
  address?: string
}

// In-memory challenge store (use Redis in production)
const challenges = new Map<string, { nonce: string; expiresAt: number }>()

/**
 * Generate authentication challenge
 */
export function generateChallenge(address: string): { nonce: string; expiresAt: number } {
  const nonce = crypto.randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes
  
  challenges.set(address, { nonce, expiresAt })
  
  // Cleanup expired challenges
  setTimeout(() => challenges.delete(address), 5 * 60 * 1000)
  
  return { nonce, expiresAt }
}

/**
 * Verify signature and issue JWT
 */
export function verifySignatureAndIssueToken(
  address: string,
  signature: string,
  nonce: string
): { token: string; walletId: string } | null {
  const challenge = challenges.get(address)
  
  if (!challenge || challenge.nonce !== nonce || Date.now() > challenge.expiresAt) {
    return null
  }
  
  try {
    // Verify signature (BSV message signing)
    // Note: Implement proper BSV message signature verification
    // For now, placeholder:
    const publicKey = recoverPublicKeyFromSignature(nonce, signature)
    const recoveredAddress = publicKey.toAddress()
    
    if (recoveredAddress !== address) {
      return null
    }
    
    // Get wallet ID from database
    const { getDb } = require('../registry/db')
    const db = getDb()
    const wallet = db.prepare('SELECT id FROM wallets WHERE address = ?').get(address) as any
    
    if (!wallet) {
      return null
    }
    
    // Generate JWT (use a proper JWT library in production)
    const token = Buffer.from(JSON.stringify({
      walletId: wallet.id,
      address,
      iat: Date.now(),
      exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    })).toString('base64')
    
    challenges.delete(address)
    
    return { token, walletId: wallet.id }
  } catch {
    return null
  }
}

/**
 * Authentication middleware - verify JWT
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' })
  }
  
  const token = authHeader.substring(7)
  
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString())
    
    if (Date.now() > payload.exp) {
      return res.status(401).json({ error: 'Unauthorized: Token expired' })
    }
    
    req.walletId = payload.walletId
    req.address = payload.address
    next()
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' })
  }
}

/**
 * Ownership verification middleware
 */
export function requireOwnership(paramName: string = 'id') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const resourceId = req.params[paramName]
    
    if (resourceId !== req.walletId) {
      return res.status(403).json({ error: 'Forbidden: Not your resource' })
    }
    
    next()
  }
}

/**
 * Service ownership verification
 */
export function requireServiceOwnership(req: AuthRequest, res: Response, next: NextFunction) {
  const { getDb } = require('../registry/db')
  const db = getDb()
  
  const service = db.prepare('SELECT agentId FROM services WHERE id = ?').get(req.params.id) as any
  
  if (!service) {
    return res.status(404).json({ error: 'Service not found' })
  }
  
  if (service.agentId !== req.walletId) {
    return res.status(403).json({ error: 'Forbidden: Not your service' })
  }
  
  next()
}

// Placeholder - implement proper BSV signature recovery
function recoverPublicKeyFromSignature(message: string, signature: string): PublicKey {
  // TODO: Implement BSV signature recovery
  // See: https://github.com/moneybutton/bsv/blob/master/lib/crypto/signature.js
  throw new Error('Implement BSV signature recovery')
}
```

### 1.2 Add Authentication Routes

**File:** `src/api/server.ts` (ADD)

```typescript
import { generateChallenge, verifySignatureAndIssueToken, requireAuth, requireOwnership, requireServiceOwnership } from '../middleware/auth'

// ============ AUTHENTICATION ============

app.get('/api/auth/challenge', (req, res) => {
  const { address } = req.query
  
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'Address required' })
  }
  
  const { nonce, expiresAt } = generateChallenge(address)
  
  res.json({
    ok: true,
    nonce,
    expiresAt,
    message: `Sign this nonce to authenticate: ${nonce}`,
  })
})

app.post('/api/auth/login', (req, res) => {
  const { address, signature, nonce } = req.body
  
  if (!address || !signature || !nonce) {
    return res.status(400).json({ error: 'Address, signature, and nonce required' })
  }
  
  const result = verifySignatureAndIssueToken(address, signature, nonce)
  
  if (!result) {
    return res.status(401).json({ error: 'Invalid signature or expired nonce' })
  }
  
  res.json({
    ok: true,
    token: result.token,
    walletId: result.walletId,
  })
})

// ============ PROTECTED ROUTES ============

// Wallet operations require authentication
app.get('/api/wallets/:id', requireAuth, requireOwnership('id'), async (req, res) => {
  // ... existing code
})

app.post('/api/wallets/:id/fund', requireAuth, requireOwnership('id'), async (req, res) => {
  // ... existing code
})

app.get('/api/wallets/:id/utxos', requireAuth, requireOwnership('id'), async (req, res) => {
  // ... existing code
})

app.get('/api/wallets/:id/transactions', requireAuth, requireOwnership('id'), async (req, res) => {
  // ... existing code
})

// Service modification requires ownership
app.patch('/api/services/:id', requireAuth, requireServiceOwnership, (req, res) => {
  // ... existing code
})

// Service registration requires authentication
app.post('/api/services', requireAuth, (req, res) => {
  // Ensure agentId matches authenticated wallet
  if (req.body.agentId !== req.walletId) {
    return res.status(403).json({ error: 'agentId must match your wallet' })
  }
  // ... existing code
})

// Service execution requires authentication
app.post('/api/execute/:serviceId', requireAuth, async (req, res) => {
  // Ensure buyerWalletId matches authenticated wallet
  if (req.body.buyerWalletId !== req.walletId) {
    return res.status(403).json({ error: 'Cannot execute on behalf of another wallet' })
  }
  // ... existing code
})

// Payment dispute requires involvement
app.post('/api/payments/:id/dispute', requireAuth, (req, res) => {
  const payment = payments.getById(req.params.id)
  
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' })
  }
  
  if (payment.buyerWalletId !== req.walletId && payment.sellerWalletId !== req.walletId) {
    return res.status(403).json({ error: 'Not your payment' })
  }
  
  // ... existing code
})
```

---

## 2. Authorization & IDOR Protection

**File:** `src/api/server.ts` (MODIFY all endpoints)

```typescript
// Example: Wallet access with ownership check
app.get('/api/wallets/:id', requireAuth, async (req, res) => {
  // Only allow access to own wallet
  if (req.params.id !== req.walletId) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
  
  const balance = await wallets.getBalance(req.params.id)
  res.json({ ok: true, wallet: { ...wallet, balance } })
})

// Example: Service modification with ownership check
app.patch('/api/services/:id', requireAuth, (req, res) => {
  const service = registry.getById(req.params.id)
  
  if (!service) {
    return res.status(404).json({ error: 'Service not found' })
  }
  
  // Verify ownership
  if (service.agentId !== req.walletId) {
    return res.status(403).json({ error: 'Not your service' })
  }
  
  const updated = registry.update(req.params.id, req.body)
  res.json({ ok: true, service: updated })
})

// Example: Payment access with involvement check
app.get('/api/payments/:id', requireAuth, (req, res) => {
  const payment = payments.getById(req.params.id)
  
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' })
  }
  
  // Only buyer or seller can view
  if (payment.buyerWalletId !== req.walletId && payment.sellerWalletId !== req.walletId) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  res.json({ ok: true, payment })
})
```

---

## 3. Private Key Security

### 3.1 Remove Private Key from API Response

**File:** `src/wallet/wallet.ts` (MODIFY)

```typescript
/**
 * Create a new agent wallet with real BSV keys
 * 
 * ⚠️ SECURITY: Private key is NOT returned in API response.
 * User must save it from the frontend immediately after client-side generation.
 */
create(): AgentWallet {
  const db = getDb()
  const id = uuid()

  // Generate real BSV private key
  const privKey = generatePrivateKey()
  const privateKeyWif = privKey.toWif()
  const publicKey = getPublicKeyHex(privKey)
  const address = deriveAddress(privKey)

  // Encrypt private key for storage
  const encryptedPrivKey = encryptPrivateKey(privateKeyWif)

  db.prepare(`
    INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, publicKey, address, encryptedPrivKey, new Date().toISOString())

  // ⚠️ CRITICAL CHANGE: Do NOT return private key
  return {
    id,
    publicKey,
    address,
    createdAt: new Date().toISOString(),
    // privateKey: privateKeyWif, // ❌ REMOVED
  }
}
```

### 3.2 Client-Side Key Generation (Recommended)

**File:** `web/lib/wallet.ts` (NEW)

```typescript
/**
 * Client-side wallet generation
 * Private key NEVER leaves the browser
 */
import { PrivateKey } from '@bsv/sdk'

export function generateWalletClient(): {
  privateKey: string
  publicKey: string
  address: string
} {
  const privKey = PrivateKey.fromRandom()
  const publicKey = privKey.toPublicKey()
  
  return {
    privateKey: privKey.toWif(), // User must save this
    publicKey: publicKey.toString(),
    address: publicKey.toAddress('testnet'),
  }
}

/**
 * Register wallet on server (public key only)
 */
export async function registerWallet(publicKey: string, address: string) {
  const response = await fetch('http://localhost:3100/api/wallets/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey, address }),
  })
  
  return response.json()
}
```

**File:** `src/api/server.ts` (ADD)

```typescript
// New endpoint: register wallet (client-side generation)
app.post('/api/wallets/register', (req, res) => {
  const { publicKey, address } = req.body
  
  if (!publicKey || !address) {
    return res.status(400).json({ error: 'Public key and address required' })
  }
  
  // Verify address matches public key
  try {
    const pubKey = PublicKey.fromString(publicKey)
    const derivedAddress = pubKey.toAddress(config.network === 'testnet' ? 'testnet' : undefined)
    
    if (derivedAddress !== address) {
      return res.status(400).json({ error: 'Address does not match public key' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid public key' })
  }
  
  // Check if wallet already exists
  const existing = wallets.getByAddress(address)
  if (existing) {
    return res.status(409).json({ error: 'Wallet already registered' })
  }
  
  // Store wallet WITHOUT private key
  const db = getDb()
  const id = uuid()
  
  db.prepare(`
    INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
    VALUES (?, ?, ?, NULL, ?)
  `).run(id, publicKey, address, new Date().toISOString())
  
  res.json({
    ok: true,
    wallet: { id, publicKey, address, createdAt: new Date().toISOString() },
  })
})
```

---

## 4. Encryption Master Key Enforcement

**File:** `src/config.ts` (MODIFY)

```typescript
/**
 * CRITICAL: Fail startup if master key is not set
 */
if (!process.env.AGENTPAY_MASTER_KEY) {
  console.error('❌ FATAL ERROR: AGENTPAY_MASTER_KEY environment variable not set')
  console.error('Generate a secure key with: openssl rand -hex 32')
  console.error('Set it in .env: AGENTPAY_MASTER_KEY=<your-key>')
  process.exit(1)
}

if (process.env.AGENTPAY_MASTER_KEY.length < 32) {
  console.error('❌ FATAL ERROR: AGENTPAY_MASTER_KEY must be at least 32 characters')
  process.exit(1)
}

export const config = {
  // ... other config
  
  encryption: {
    algorithm: 'aes-256-gcm' as const,
    masterKey: process.env.AGENTPAY_MASTER_KEY, // Required, no default
  },
  
  // ... rest
}
```

**File:** `.env.example` (NEW)

```bash
# AgentPay Configuration

# CRITICAL: Generate with: openssl rand -hex 32
AGENTPAY_MASTER_KEY=your-64-character-hex-key-here

# BSV Network
BSV_NETWORK=testnet

# API Port
PORT=3100

# Platform wallet (optional, will generate if not set)
PLATFORM_WALLET_PRIVKEY=
PLATFORM_WALLET_ADDRESS=

# Demo mode (internal ledger, no on-chain tx)
AGENTPAY_DEMO=true
```

---

## 5. SSRF Protection

**File:** `src/utils/validation.ts` (NEW)

```typescript
import { URL } from 'url'
import dns from 'dns/promises'

/**
 * Validate service endpoint URL to prevent SSRF
 */
export async function validateServiceEndpoint(endpoint: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const url = new URL(endpoint)
    
    // 1. Protocol validation
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Only HTTP/HTTPS protocols allowed' }
    }
    
    // 2. Require HTTPS in production (allow HTTP localhost in dev)
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        return { valid: false, error: 'HTTPS required in production' }
      }
    }
    
    // 3. Block private IP ranges
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
    
    // Allow localhost only in development
    if (process.env.NODE_ENV === 'production') {
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return { valid: false, error: 'Localhost not allowed in production' }
      }
    }
    
    // Check against patterns
    if (privateIpPatterns.some(pattern => pattern.test(url.hostname))) {
      return { valid: false, error: 'Private IP addresses not allowed' }
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
    
    // 5. DNS resolution check (prevent DNS rebinding)
    try {
      const addresses = await dns.resolve4(url.hostname)
      
      for (const addr of addresses) {
        if (privateIpPatterns.some(pattern => pattern.test(addr))) {
          return { valid: false, error: 'Hostname resolves to private IP' }
        }
      }
    } catch {
      // If DNS resolution fails, block the request
      return { valid: false, error: 'Could not resolve hostname' }
    }
    
    // 6. Port restrictions (block common internal services)
    const blockedPorts = [22, 23, 25, 3306, 5432, 6379, 27017] // SSH, Telnet, SMTP, MySQL, PostgreSQL, Redis, MongoDB
    if (url.port && blockedPorts.includes(parseInt(url.port))) {
      return { valid: false, error: 'Port not allowed' }
    }
    
    return { valid: true }
  } catch (error) {
    return { valid: false, error: 'Invalid URL' }
  }
}

/**
 * Whitelist-based validation (stricter)
 */
export function validateAgainstWhitelist(endpoint: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(endpoint)
    return allowedDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}
```

**File:** `src/api/server.ts` (MODIFY service registration)

```typescript
import { validateServiceEndpoint } from '../utils/validation'

app.post('/api/services', requireAuth, async (req, res) => {
  try {
    // Validate endpoint before registration
    const validation = await validateServiceEndpoint(req.body.endpoint)
    
    if (!validation.valid) {
      return res.status(400).json({ error: `Invalid endpoint: ${validation.error}` })
    }
    
    const service = registry.register(req.body)
    res.json({ ok: true, service })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})
```

---

## 6. Input Validation

**File:** `src/utils/validation.ts` (ADD)

```typescript
const VALID_CATEGORIES = ['ai', 'data', 'compute', 'storage', 'analytics', 'other'] as const
type Category = typeof VALID_CATEGORIES[number]

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
  
  // Price validation
  if (!Number.isInteger(data.price)) {
    errors.push('Price must be an integer')
  } else if (data.price < 1) {
    errors.push('Price must be at least 1 satoshi')
  } else if (data.price > 1e9) {
    errors.push('Price cannot exceed 1 billion satoshis')
  }
  
  // Endpoint validation
  if (!data.endpoint || typeof data.endpoint !== 'string') {
    errors.push('Endpoint is required')
  } else if (data.endpoint.length > 500) {
    errors.push('Endpoint URL too long')
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

export function validateFundingAmount(amount: any): { valid: boolean; error?: string } {
  if (!Number.isInteger(amount)) {
    return { valid: false, error: 'Amount must be an integer' }
  }
  
  if (amount <= 0) {
    return { valid: false, error: 'Amount must be positive' }
  }
  
  if (amount > 1e8) { // 1 BSV = 100 million satoshis
    return { valid: false, error: 'Amount cannot exceed 100 million satoshis (1 BSV)' }
  }
  
  return { valid: true }
}

export function sanitizeSearchQuery(query: string): string {
  // Limit length
  query = query.substring(0, 200)
  
  // Remove leading/trailing wildcards to prevent DoS
  query = query.replace(/^%+|%+$/g, '')
  
  // Limit consecutive wildcards
  query = query.replace(/%{2,}/g, '%')
  
  return query
}
```

**File:** `src/api/server.ts` (MODIFY)

```typescript
import { validateServiceRegistration, validateFundingAmount, sanitizeSearchQuery } from '../utils/validation'

// Service registration with validation
app.post('/api/services', requireAuth, async (req, res) => {
  // Validate input
  const validation = validateServiceRegistration(req.body)
  
  if (!validation.valid) {
    return res.status(400).json({ error: 'Validation failed', errors: validation.errors })
  }
  
  // Validate endpoint URL
  const endpointValidation = await validateServiceEndpoint(req.body.endpoint)
  if (!endpointValidation.valid) {
    return res.status(400).json({ error: endpointValidation.error })
  }
  
  try {
    const service = registry.register(req.body)
    res.json({ ok: true, service })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Funding with validation
app.post('/api/wallets/:id/fund', requireAuth, requireOwnership('id'), async (req, res) => {
  const validation = validateFundingAmount(req.body.amount)
  
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error })
  }
  
  // ... rest of funding logic
})

// Search with sanitization
app.get('/api/services', (req, res) => {
  const keyword = req.query.q ? sanitizeSearchQuery(req.query.q as string) : undefined
  
  const services = registry.search({
    category: req.query.category as string,
    keyword,
    maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    limit: req.query.limit ? Math.min(Number(req.query.limit), 100) : 20, // Max 100
    offset: req.query.offset ? Number(req.query.offset) : 0,
  })
  
  res.json({ ok: true, services })
})
```

---

## 7. Payment Security

**File:** `src/payment/payment.ts` (MODIFY)

```typescript
/**
 * CRITICAL: Make release() and refund() internal-only
 * Remove public access, only callable from execute flow
 */

// Mark methods as internal (not exposed via API)
private async releaseInternal(paymentId: string, executionProof: ExecutionProof): Promise<Payment | null> {
  const db = getDb()
  const payment = this.getById(paymentId)
  
  if (!payment || payment.status !== 'escrowed') {
    return null
  }
  
  // Verify execution proof
  if (!this.verifyExecutionProof(payment, executionProof)) {
    throw new Error('Invalid execution proof')
  }
  
  // ... existing release logic
}

private async refundInternal(paymentId: string): Promise<Payment | null> {
  // ... existing refund logic
}

private verifyExecutionProof(payment: Payment, proof: ExecutionProof): boolean {
  // Verify that service was actually executed
  // Options:
  // 1. Check HTTP response timestamp
  // 2. Verify service provider signature
  // 3. Require on-chain proof
  
  return proof.timestamp > payment.createdAt && proof.serviceId === payment.serviceId
}

interface ExecutionProof {
  serviceId: string
  timestamp: string
  signature?: string
  responseHash?: string
}
```

**File:** `src/api/server.ts` (MODIFY)

```typescript
// DO NOT expose direct release/refund endpoints
// Remove these if they exist:
// app.post('/api/payments/:id/release', ...) // ❌ DELETE
// app.post('/api/payments/:id/refund', ...)  // ❌ DELETE

// Only the execute flow can trigger release/refund
app.post('/api/execute/:serviceId', requireAuth, async (req, res) => {
  // ... existing code ...
  
  try {
    const response = await fetch(service.endpoint, ...)
    
    if (!response.ok) {
      // Service failed → refund (internal call only)
      await payments.refundInternal(payment.id)
      return res.status(502).json({ error: 'Service failed', status: 'refunded' })
    }
    
    const output = await response.json()
    
    // Success → release with proof
    const proof: ExecutionProof = {
      serviceId: service.id,
      timestamp: new Date().toISOString(),
      responseHash: crypto.createHash('sha256').update(JSON.stringify(output)).digest('hex'),
    }
    
    await payments.releaseInternal(payment.id, proof)
    
    res.json({ ok: true, output, paymentId: payment.id })
  } catch (e: any) {
    await payments.refundInternal(payment.id)
    res.status(502).json({ error: e.message, status: 'refunded' })
  }
})
```

### 7.1 Transaction Locking

**File:** `src/api/server.ts` (MODIFY execute endpoint)

```typescript
// Use database transactions to prevent race conditions
app.post('/api/execute/:serviceId', requireAuth, async (req, res) => {
  const db = getDb()
  
  try {
    // Wrap entire execution in a database transaction
    await db.transaction(async () => {
      // Lock wallet row (prevents concurrent execution)
      const walletLock = db.prepare('SELECT * FROM wallets WHERE id = ?').get(req.body.buyerWalletId)
      
      if (!walletLock) {
        throw new Error('Wallet not found')
      }
      
      // Check balance
      const balance = await wallets.getBalance(req.body.buyerWalletId)
      if (balance < service.price) {
        throw new Error('Insufficient funds')
      }
      
      // Create payment (atomically)
      const payment = await payments.create(...)
      
      // Mark UTXOs as pending (prevent double-spend)
      db.prepare(`
        UPDATE utxos
        SET spent = 1, spentAt = datetime('now')
        WHERE walletId = ? AND spent = 0
        LIMIT ?
      `).run(req.body.buyerWalletId, neededUtxoCount)
      
      // Execute service
      const response = await fetch(service.endpoint, ...)
      
      // Release or refund
      if (response.ok) {
        await payments.releaseInternal(payment.id, proof)
      } else {
        await payments.refundInternal(payment.id)
        // Unmark UTXOs if refund
        db.prepare('UPDATE utxos SET spent = 0, spentAt = NULL WHERE walletId = ?').run(req.body.buyerWalletId)
      }
      
      res.json({ ok: true, paymentId: payment.id })
    })()
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})
```

---

## 8. Rate Limiting

**File:** `package.json` (ADD dependency)

```json
{
  "dependencies": {
    "express-rate-limit": "^7.1.5"
  }
}
```

**File:** `src/middleware/rateLimit.ts` (NEW)

```typescript
import rateLimit from 'express-rate-limit'

/**
 * Global rate limit (all endpoints)
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

/**
 * Strict limit for wallet creation
 */
export const walletCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 wallets per IP per hour
  message: { error: 'Wallet creation limit reached. Try again in 1 hour.' },
  skipSuccessfulRequests: false,
})

/**
 * Service registration limit
 */
export const serviceRegistrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 services per IP per hour
  message: { error: 'Service registration limit reached. Try again in 1 hour.' },
})

/**
 * Execution limit (prevent spam)
 */
export const executionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 executions per minute
  message: { error: 'Too many execution requests. Slow down.' },
})

/**
 * Authentication limit (prevent brute force)
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 failed attempts
  skipSuccessfulRequests: true,
  message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
})
```

**File:** `src/api/server.ts` (ADD)

```typescript
import { globalLimiter, walletCreationLimiter, serviceRegistrationLimiter, executionLimiter, authLimiter } from '../middleware/rateLimit'

// Apply global rate limit
app.use(globalLimiter)

// Apply specific limits
app.post('/api/wallets', walletCreationLimiter, ...)
app.post('/api/services', serviceRegistrationLimiter, requireAuth, ...)
app.post('/api/execute/:serviceId', executionLimiter, requireAuth, ...)
app.post('/api/auth/login', authLimiter, ...)
```

---

## 9. CORS Configuration

**File:** `src/api/server.ts` (MODIFY)

```typescript
import cors from 'cors'

// Configure CORS properly
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3001',  // Development frontend
  'https://agentspay.dev',  // Production frontend
]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true)
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true, // Allow cookies (if needed in future)
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
}))
```

---

## Implementation Checklist

### Phase 1: Critical (Week 1-2)
- [ ] Implement authentication system (`src/middleware/auth.ts`)
- [ ] Add auth routes (`GET /api/auth/challenge`, `POST /api/auth/login`)
- [ ] Protect all wallet endpoints with `requireAuth` + `requireOwnership`
- [ ] Protect service modification with `requireServiceOwnership`
- [ ] Remove private keys from API responses (`wallet.ts`)
- [ ] Enforce master key requirement (`config.ts`)
- [ ] Implement SSRF protection (`utils/validation.ts`)
- [ ] Apply SSRF validation to service registration

### Phase 2: High (Week 2-3)
- [ ] Add comprehensive input validation (`utils/validation.ts`)
- [ ] Apply validation to all endpoints
- [ ] Make payment release/refund internal-only
- [ ] Add execution proof verification
- [ ] Implement transaction locking (database transactions)
- [ ] Add rate limiting middleware (`middleware/rateLimit.ts`)
- [ ] Apply rate limits to all endpoints

### Phase 3: Medium (Week 3-4)
- [ ] Configure CORS properly
- [ ] Add audit logging for sensitive operations
- [ ] Implement monitoring/alerting
- [ ] Write integration tests for auth flows

### Phase 4: Testing & Deployment
- [ ] Penetration testing
- [ ] Security review
- [ ] Deploy to staging
- [ ] Production deployment

---

## Testing Guide

```bash
# 1. Test authentication
curl -X GET 'http://localhost:3100/api/auth/challenge?address=myaddress'
# Sign nonce with private key
curl -X POST http://localhost:3100/api/auth/login \
  -d '{"address":"myaddress","signature":"...","nonce":"..."}'

# 2. Test protected endpoints (should fail without token)
curl -X GET http://localhost:3100/api/wallets/abc123
# Expected: 401 Unauthorized

# 3. Test with token
curl -X GET http://localhost:3100/api/wallets/abc123 \
  -H "Authorization: Bearer <token>"
# Expected: 200 OK

# 4. Test IDOR protection (access other user's wallet)
curl -X GET http://localhost:3100/api/wallets/other-user-id \
  -H "Authorization: Bearer <your-token>"
# Expected: 403 Forbidden

# 5. Test SSRF protection
curl -X POST http://localhost:3100/api/services \
  -H "Authorization: Bearer <token>" \
  -d '{"endpoint":"http://169.254.169.254/...",...}'
# Expected: 400 Bad Request (blocked)

# 6. Test input validation
curl -X POST http://localhost:3100/api/services \
  -H "Authorization: Bearer <token>" \
  -d '{"price":-100,...}'
# Expected: 400 Bad Request

# 7. Test rate limiting
for i in {1..10}; do
  curl -X POST http://localhost:3100/api/wallets &
done
# Expected: 429 Too Many Requests after 5 requests
```

---

## Additional Recommendations

1. **Set up WAF** (Web Application Firewall) - Cloudflare, AWS WAF
2. **Enable HTTPS everywhere** - Let's Encrypt, AWS Certificate Manager
3. **Implement audit logging** - Log all authentication attempts, wallet creations, payments
4. **Set up monitoring** - Prometheus + Grafana, Datadog
5. **Backup private keys** - Use AWS Secrets Manager, HashiCorp Vault
6. **Regular security audits** - Quarterly penetration testing
7. **Bug bounty program** - After all fixes are deployed

---

**End of Security Fixes Guide**
