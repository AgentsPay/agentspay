import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'path'
// Load .env from monorepo root
dotenvConfig({ path: resolve(process.cwd(), '.env') })

process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err); })
process.on('unhandledRejection', (err) => { console.error('UNHANDLED:', err); })

import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import crypto from 'crypto'
import {
  BSM,
  Signature as BsvSignature,
  PublicKey as BsvPublicKey,
  BigNumber as BsvBigNumber,
  TransactionSignature as BsvTransactionSignature,
} from '@bsv/sdk'
import { getInstance } from '@handcash/sdk'
import {
  WalletManager,
  Registry,
  PaymentEngine,
  getDb,
  WebhookManager,
  webhookDelivery,
  DisputeManager,
  mneeTokens,
  CurrencyManager,
  VerificationManager,
  JobManager,
  AgentIdentityManager,
  ContractManager,
  validateServiceEndpoint,
} from '@agentspay/core'
import { setupSwagger } from './docs/swagger'
import { requireApiKey, requireWalletMatch, getApiKey, setAuthCookie, clearAuthCookie } from './middleware/auth'
import { apiRateLimit, adminRateLimit } from './middleware/rateLimit'
import { buildPaymentRequired, parsePaymentReceipt } from './middleware/x402'
import { inspectPromptInjection } from './security/promptGuard'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) || []
const isDemoMode = process.env.AGENTPAY_DEMO === 'true'

// CORS: credentials required for httpOnly cookie auth (never reflect arbitrary origins)
const corsOrigins = allowedOrigins.length > 0
  ? allowedOrigins
  : ['http://localhost:3000', 'http://localhost:3001']

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}))

app.use((req, res, next) => {
  const inboundRequestId = req.header('x-request-id')
  const requestId = (inboundRequestId && inboundRequestId.length <= 128)
    ? inboundRequestId
    : crypto.randomUUID()
  ;(req as any).requestId = requestId
  res.setHeader('X-Request-Id', requestId)

  if (req.path.startsWith('/api')) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    res.setHeader('Cache-Control', 'no-store')

    // Enable HSTS only when traffic is already over HTTPS.
    const isHttps = req.secure || req.header('x-forwarded-proto') === 'https'
    if (process.env.NODE_ENV === 'production' && isHttps) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
  }

  next()
})

app.use(cookieParser())
app.use(express.json())

// Setup Swagger UI documentation at /docs
setupSwagger(app)

// Basic API rate limiting (in-memory)
app.use('/api', apiRateLimit)
app.use('/api/admin', adminRateLimit)

const wallets = new WalletManager()
const registry = new Registry()
const payments = new PaymentEngine()
const webhooks = new WebhookManager()
const disputes = new DisputeManager()
const verification = new VerificationManager()
const jobManager = new JobManager(payments, verification)
const identityManager = new AgentIdentityManager()
const contracts = new ContractManager()

// Create middleware instances with wallet manager
const authMiddleware = requireApiKey(wallets)
type AdminKeyVersion = 'current' | 'previous' | 'legacy'
const ADMIN_WALLET_2FA_REQUIRED = process.env.ADMIN_WALLET_2FA_REQUIRED === 'true'
const ADMIN_WALLET_SESSION_MINUTES = Math.min(Math.max(Number(process.env.ADMIN_WALLET_SESSION_MINUTES || 15), 5), 240)
const ADMIN_WALLET_CHALLENGE_TTL_SECONDS = Math.min(Math.max(Number(process.env.ADMIN_WALLET_CHALLENGE_TTL_SECONDS || 120), 30), 900)
const ADMIN_WALLET_ADDRESSES = (process.env.ADMIN_WALLET_ADDRESSES || '')
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean)

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function getAdminWalletToken(req: express.Request): string | null {
  const headerValue = req.headers['x-admin-wallet-token']
  if (!headerValue) return null
  return Array.isArray(headerValue) ? headerValue[0] : headerValue
}

function getAdminSession(token: string): { walletAddress: string; expiresAt: string } | null {
  const db = getDb()
  const now = new Date().toISOString()
  const row = db.prepare(`
    SELECT walletAddress, expiresAt
    FROM admin_auth_sessions
    WHERE tokenHash = ? AND revokedAt IS NULL AND expiresAt > ?
  `).get(hashToken(token), now) as any
  if (!row) return null
  return {
    walletAddress: row.walletAddress,
    expiresAt: row.expiresAt,
  }
}

function isAllowedAdminWallet(address: string): boolean {
  return ADMIN_WALLET_ADDRESSES.includes(address)
}

function verifyBsmSignatureForAddress(message: string, signature: string, address: string): boolean {
  const messageBytes = Array.from(Buffer.from(message, 'utf8'))
  const msgHash = new BsvBigNumber(BSM.magicHash(messageBytes))

  const recoveredPubKey = BsvPublicKey.fromMsgHashAndCompactSignature(msgHash, signature, 'base64')
  const recoveredMainnet = recoveredPubKey.toAddress('mainnet')
  const recoveredTestnet = recoveredPubKey.toAddress('testnet')

  if (address !== recoveredMainnet && address !== recoveredTestnet) return false

  const parsedSig = BsvSignature.fromCompact(signature, 'base64')
  return BSM.verify(messageBytes, parsedSig, recoveredPubKey)
}

function getConfiguredAdminKeys(): Array<{ value: string; version: AdminKeyVersion }> {
  const keys: Array<{ value: string; version: AdminKeyVersion }> = []
  if (process.env.AGENTPAY_MASTER_KEY_CURRENT) keys.push({ value: process.env.AGENTPAY_MASTER_KEY_CURRENT, version: 'current' })
  if (process.env.AGENTPAY_MASTER_KEY_PREVIOUS) keys.push({ value: process.env.AGENTPAY_MASTER_KEY_PREVIOUS, version: 'previous' })
  if (process.env.AGENTPAY_MASTER_KEY) keys.push({ value: process.env.AGENTPAY_MASTER_KEY, version: 'legacy' })

  // Deduplicate while preserving order
  const seen = new Set<string>()
  return keys.filter((k) => {
    if (seen.has(k.value)) return false
    seen.add(k.value)
    return true
  })
}

function secureSecretEquals(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest()
  const bh = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ah, bh)
}

function matchAdminKey(provided: string): AdminKeyVersion | null {
  const keys = getConfiguredAdminKeys()
  for (const key of keys) {
    if (secureSecretEquals(provided, key.value)) return key.version
  }
  return null
}

function isAdminHeaderAuthorized(req: express.Request): boolean {
  const headerValue = req.headers['x-admin-key']
  const adminKey = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!adminKey) return false
  return matchAdminKey(adminKey) !== null
}

function auditAdminAction(
  req: express.Request,
  action: string,
  status: 'success' | 'denied' | 'error',
  details?: Record<string, unknown>,
  disputeId?: string
): void {
  try {
    const db = getDb()
    const headerValue = req.headers['user-agent']
    const userAgent = Array.isArray(headerValue) ? headerValue[0] : headerValue
    const adminKeyVersion = (req as any).adminAuth?.version || null
    db.prepare(`
      INSERT INTO admin_audit_logs (action, status, adminKeyVersion, disputeId, ip, userAgent, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      action,
      status,
      adminKeyVersion,
      disputeId || null,
      req.ip || null,
      userAgent || null,
      details ? JSON.stringify(details) : null
    )
  } catch {
    // Audit logging must never block admin actions.
  }
}

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const keys = getConfiguredAdminKeys()
  if (keys.length === 0) {
    auditAdminAction(req, 'admin.auth', 'error', { error: 'master_key_not_configured' })
    return res.status(503).json({ error: 'Master key not configured' })
  }

  const headerValue = req.headers['x-admin-key']
  const adminKey = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!adminKey) {
    auditAdminAction(req, 'admin.auth', 'denied', { reason: 'missing_admin_key' })
    return res.status(403).json({ error: 'Admin privileges required. Provide valid X-Admin-Key header.' })
  }

  const matchedVersion = matchAdminKey(adminKey)
  if (!matchedVersion) {
    auditAdminAction(req, 'admin.auth', 'denied', { reason: 'invalid_admin_key' })
    return res.status(403).json({ error: 'Admin privileges required. Provide valid X-Admin-Key header.' })
  }

  const authContext: any = { version: matchedVersion }
  const adminPath = req.path || ''
  const is2faBootstrapEndpoint =
    adminPath === '/api/admin/auth/challenge' || adminPath === '/api/admin/auth/verify'

  const walletToken = getAdminWalletToken(req)
  if (walletToken) {
    const session = getAdminSession(walletToken)
    if (!session) {
      auditAdminAction(req, 'admin.auth', 'denied', { reason: 'invalid_wallet_session' })
      return res.status(403).json({ error: 'Invalid or expired admin wallet session token.' })
    }
    authContext.walletAddress = session.walletAddress
    authContext.walletSessionExpiresAt = session.expiresAt
  }

  if (ADMIN_WALLET_2FA_REQUIRED && !is2faBootstrapEndpoint && !authContext.walletAddress) {
    auditAdminAction(req, 'admin.auth', 'denied', { reason: 'wallet_2fa_required' })
    return res.status(403).json({
      error: 'Admin wallet verification required. Provide valid X-Admin-Wallet-Token.',
    })
  }

  ;(req as any).adminAuth = authContext
  next()
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function hashExecutionTerms(service: any, input: unknown): string {
  const payload = {
    version: 1,
    serviceId: service.id,
    serviceName: service.name,
    serviceDescription: service.description,
    price: service.price,
    currency: service.currency || 'BSV',
    timeout: service.timeout || 30,
    disputeWindow: service.disputeWindow || 30,
    input,
  }
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex')
}

function parseSettlementAction(value: unknown): 'release' | 'refund' | null {
  if (value === 'release' || value === 'refund') return value
  return null
}

function normalizeTxSignatureToChecksigHex(inputSignature: string, opts?: {
  sighashType?: number
  digestHex?: string
  publicKeyHex?: string
}): { checksigHex: string; scope: number; detectedFormat: string; verified?: boolean } {
  const raw = (inputSignature || '').trim()
  if (!raw) throw new Error('Signature is required')
  const defaultSighash = BsvTransactionSignature.SIGHASH_FORKID | BsvTransactionSignature.SIGHASH_ALL
  const desiredScope = Number.isInteger(opts?.sighashType) ? Number(opts?.sighashType) : defaultSighash

  const tryAsBytes = (bytes: number[], label: string) => {
    try {
      const txSig = BsvTransactionSignature.fromChecksigFormat(bytes)
      return { txSig, format: `${label}:checksig` }
    } catch {
      // continue
    }
    try {
      const derSig = BsvSignature.fromDER(bytes)
      return { txSig: new BsvTransactionSignature(derSig.r, derSig.s, desiredScope), format: `${label}:der` }
    } catch {
      // continue
    }
    try {
      const compactSig = BsvSignature.fromCompact(bytes)
      return { txSig: new BsvTransactionSignature(compactSig.r, compactSig.s, desiredScope), format: `${label}:compact` }
    } catch {
      // continue
    }
    return null
  }

  let parsed: { txSig: any; format: string } | null = null
  const hex = raw.replace(/^0x/i, '').replace(/\s+/g, '')
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    parsed = tryAsBytes(Array.from(Buffer.from(hex, 'hex')), 'hex')
  }
  if (!parsed) {
    try {
      const buf = Buffer.from(raw, 'base64')
      const normalized = buf.toString('base64').replace(/=+$/g, '')
      const rawNormalized = raw.replace(/\s+/g, '').replace(/=+$/g, '')
      if (buf.length > 0 && normalized === rawNormalized) {
        parsed = tryAsBytes(Array.from(buf), 'base64')
      }
    } catch {
      // continue
    }
  }
  if (!parsed) throw new Error('Unsupported signature format. Use checksig hex, DER (hex/base64), or compact (hex/base64).')

  const checksigBytes = parsed.txSig.toChecksigFormat() as number[]
  let verified: boolean | undefined
  if (opts?.digestHex && opts?.publicKeyHex) {
    const digest = Array.from(Buffer.from(opts.digestHex, 'hex'))
    const pub = BsvPublicKey.fromString(opts.publicKeyHex)
    verified = pub.verify(digest, parsed.txSig)
    if (!verified) throw new Error('Signature does not verify for provided digest/public key')
  }

  return {
    checksigHex: Buffer.from(checksigBytes).toString('hex'),
    scope: parsed.txSig.scope,
    detectedFormat: parsed.format,
    verified,
  }
}

function enforcePromptGuard(
  req: express.Request,
  res: express.Response,
  payload: unknown,
  context: string
): { blocked: boolean; score?: number } {
  const guard = inspectPromptInjection(payload)
  if (!guard.enabled || guard.level === 'allow') return { blocked: false, score: guard.score }

  res.setHeader('X-Prompt-Guard-Level', guard.level)
  res.setHeader('X-Prompt-Guard-Score', String(guard.score))

  if (guard.level === 'warn') {
    console.warn(
      `[PromptGuard] WARN context=${context} requestId=${(req as any).requestId || '-'} score=${guard.score} findings=${guard.findings.map(f => f.id).join(',')}`
    )
    return { blocked: false, score: guard.score }
  }

  console.warn(
    `[PromptGuard] BLOCK context=${context} requestId=${(req as any).requestId || '-'} score=${guard.score} findings=${guard.findings.map(f => f.id).join(',')}`
  )
  res.status(422).json({
    error: 'Potential prompt injection detected',
    promptGuard: {
      level: guard.level,
      score: guard.score,
      findings: guard.findings,
    },
  })
  return { blocked: true, score: guard.score }
}

// ============ WALLETS ============

// Create wallet + API key for demo/internal usage
app.post('/api/wallets/connect/internal', (_req, res) => {
  const wallet = wallets.create()
  setAuthCookie(res, wallet.apiKey)
  res.json({
    ok: true,
    wallet: { id: wallet.id, publicKey: wallet.publicKey, address: wallet.address, createdAt: wallet.createdAt },
    apiKey: wallet.apiKey,  // shown once for SDK users
    privateKey: wallet.privateKey,  // shown once, never stored
  })
})

// HandCash Connect v3 - OAuth redirect
app.get('/api/wallets/connect/handcash', (_req, res) => {
  try {
    const appId = process.env.HANDCASH_APP_ID
    const appSecret = process.env.HANDCASH_APP_SECRET
    if (!appId || !appSecret) {
      return res.status(503).json({ error: 'HandCash Connect not configured. Set HANDCASH_APP_ID and HANDCASH_APP_SECRET.' })
    }
    const sdk = getInstance({ appId, appSecret }) as any
    const redirectUrl = sdk.connect.getRedirectionUrl()
    res.json({ ok: true, authUrl: redirectUrl })
  } catch (err: any) {
    res.status(500).json({ error: 'HandCash Connect error: ' + err.message })
  }
})

// HandCash OAuth callback
app.get('/api/wallets/connect/handcash/callback', async (req, res) => {
  try {
    const { authToken } = req.query
    if (!authToken) return res.status(400).json({ error: 'Missing authToken' })
    const appId = process.env.HANDCASH_APP_ID
    const appSecret = process.env.HANDCASH_APP_SECRET
    if (!appId || !appSecret) return res.status(503).json({ error: 'HandCash not configured' })
    const sdk = getInstance({ appId, appSecret }) as any
    const account = sdk.connect.getAccountClient(authToken as string)
    const profile = await account.getCurrentProfile()
    const wallet = wallets.create()
    setAuthCookie(res, wallet.apiKey)
    res.json({
      ok: true,
      wallet: { id: wallet.id, publicKey: wallet.publicKey, address: wallet.address, provider: 'handcash', externalId: profile.publicProfile.handle, createdAt: wallet.createdAt },
      apiKey: wallet.apiKey,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'HandCash callback error: ' + err.message })
  }
})

// Yours Wallet connect
app.post('/api/wallets/connect/yours', (req, res) => {
  const { publicKey } = req.body
  if (!publicKey) return res.status(400).json({ error: 'Public key required from Yours Wallet extension' })
  try {
    const wallet = wallets.create()
    setAuthCookie(res, wallet.apiKey)
    res.json({
      ok: true,
      wallet: { id: wallet.id, publicKey, address: wallet.address, provider: 'yours', createdAt: wallet.createdAt },
      apiKey: wallet.apiKey,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Yours Wallet connect error: ' + err.message })
  }
})

// Import wallet from private key (WIF)
app.post('/api/wallets/connect/import', (req, res) => {
  const { privateKey } = req.body
  if (!privateKey) return res.status(400).json({ error: 'Private key (WIF) required' })
  try {
    const wallet = wallets.importFromWif(privateKey)
    // Generate API key for the imported wallet
    const apiKey = wallets.generateApiKey()
    wallets.setApiKey(wallet.id, apiKey)
    setAuthCookie(res, apiKey)
    res.json({
      ok: true,
      wallet: { id: wallet.id, publicKey: wallet.publicKey, address: wallet.address, provider: 'import', createdAt: wallet.createdAt, apiKey },
      apiKey,
    })
  } catch (err: any) {
    res.status(400).json({ error: 'Invalid private key: ' + err.message })
  }
})

/**
 * Agent Auto-Provisioning
 * POST /api/agents/provision
 * 
 * Creates wallet + identity in one call. Returns everything an agent needs
 * to save in its .env file and start transacting immediately.
 */
app.post('/api/agents/provision', async (req, res) => {
  const { name, type, capabilities, metadata } = req.body
  if (!name) return res.status(400).json({ error: 'Agent name required' })

  try {
    // 1. Create wallet
    const wallet = wallets.create()
    setAuthCookie(res, wallet.apiKey)

    // 2. Register identity
    let identity = null
    try {
      identity = await identityManager.register(
        wallet.id, wallet.address, name,
        type || 'agent', capabilities || [], metadata || {},
        false // don't anchor on-chain by default (costs sats)
      )
    } catch (err) {
      // Identity registration is optional
    }

    // 3. Return everything the agent needs
    res.json({
      ok: true,
      agent: {
        walletId: wallet.id,
        address: wallet.address,
        publicKey: wallet.publicKey,
        apiKey: wallet.apiKey,
        privateKey: wallet.privateKey,
        identity: identity ? { displayName: identity.displayName, type: identity.type } : null,
      },
      // Ready-to-paste .env config
      envConfig: [
        `AGENTPAY_API_URL=http://localhost:3100`,
        `AGENTPAY_WALLET_ID=${wallet.id}`,
        `AGENTPAY_API_KEY=${wallet.apiKey}`,
        `AGENTPAY_ADDRESS=${wallet.address}`,
        `AGENTPAY_PRIVATE_KEY=${wallet.privateKey}`,
      ].join('\n'),
      // Quick start code
      quickStart: `import { AgentPay } from 'agentspay'\nconst ap = new AgentPay({ apiKey: '${wallet.apiKey}' })\nconst services = await ap.search({ category: 'ai' })`,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Provisioning failed: ' + err.message })
  }
})

app.post('/api/wallets', (_req, res) => {
  const wallet = wallets.create()
  setAuthCookie(res, wallet.apiKey)
  res.json({
    ok: true,
    wallet: { id: wallet.id, publicKey: wallet.publicKey, address: wallet.address, createdAt: wallet.createdAt },
    apiKey: wallet.apiKey,
    privateKey: wallet.privateKey,
  })
})

app.post('/api/wallets/import', (req, res) => {
  const { wif } = req.body
  if (!wif) return res.status(400).json({ error: 'WIF private key required' })
  try {
    const wallet = wallets.importFromWif(wif)
    res.json({ ok: true, wallet })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Disconnect wallet (clear cookie)
app.delete('/api/wallets/:id', authMiddleware, requireWalletMatch, (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

// Logout (clear cookie without auth check)
app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

app.get('/api/wallets/:id', authMiddleware, requireWalletMatch, async (req, res) => {
  const wallet = wallets.getById(String(req.params.id))
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
  const balance = await wallets.getBalance(String(req.params.id))
  const balanceMnee = await mneeTokens.getBalance(wallet.address)
  const limits = wallets.getLimits(String(req.params.id))
  res.json({ 
    ok: true, 
    wallet: { 
      ...wallet, 
      balance,
      balanceBsv: balance,
      balanceMnee,
      balances: {
        BSV: { amount: balance, formatted: CurrencyManager.format(balance, 'BSV') },
        MNEE: { amount: balanceMnee, formatted: CurrencyManager.format(balanceMnee, 'MNEE') }
      },
      ...limits,
    } 
  })
})

// ============ SPENDING LIMITS ============

app.put('/api/wallets/:id/limits', authMiddleware, requireWalletMatch, (req, res) => {
  try {
    const { txLimit, sessionLimit, dailyLimit } = req.body
    wallets.setLimits(String(req.params.id), { txLimit, sessionLimit, dailyLimit })
    const updated = wallets.getLimits(String(req.params.id))
    res.json({ ok: true, limits: updated })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

app.get('/api/wallets/:id/limits', authMiddleware, requireWalletMatch, (req, res) => {
  try {
    const limits = wallets.getLimits(String(req.params.id))
    res.json({ ok: true, limits })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// ============ CURRENCY ============

app.get('/api/rates', async (_req, res) => {
  try {
    const bsvToMnee = await CurrencyManager.getConversionRate('BSV', 'MNEE')
    const mneeToBsv = await CurrencyManager.getConversionRate('MNEE', 'BSV')
    res.json({
      ok: true,
      rates: {
        BSV_to_MNEE: bsvToMnee,
        MNEE_to_BSV: mneeToBsv
      },
      currencies: {
        BSV: CurrencyManager.getConfig('BSV'),
        MNEE: CurrencyManager.getConfig('MNEE')
      }
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/wallets/:id/fund-mnee', authMiddleware, requireWalletMatch, async (req, res) => {
  try {
    const { amount } = req.body
    const wallet = wallets.getById(String(req.params.id))
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
    
    const amountCents = Number(amount)
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw new Error('Invalid amount (must be positive integer in cents)')
    }
    
    await mneeTokens.fundDemo(wallet.address, amountCents)
    const newBalance = await mneeTokens.getBalance(wallet.address)
    
    res.json({
      ok: true,
      message: `Funded ${amountCents} MNEE cents ($${(amountCents/100).toFixed(2)})`,
      balance: newBalance,
      balanceFormatted: CurrencyManager.format(newBalance, 'MNEE')
    })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ============ SERVICES (Registry) ============

app.post('/api/services', authMiddleware, (req, res) => {
  try {
    const auth = (req as any).authWallet as { id: string }
    if (req.body?.agentId !== auth.id) return res.status(403).json({ error: 'Forbidden' })

    if (typeof req.body?.name !== 'string' || req.body.name.length < 1 || req.body.name.length > 120) {
      throw new Error('Invalid name')
    }
    if (/<script\b/i.test(req.body.name)) throw new Error('Invalid name')
    if (typeof req.body?.description !== 'string' || req.body.description.length < 1 || req.body.description.length > 2000) {
      throw new Error('Invalid description')
    }
    if (/<script\b/i.test(req.body.description)) throw new Error('Invalid description')

    const price = Number(req.body?.price)
    if (!Number.isInteger(price) || price <= 0 || price > 100000000) throw new Error('Invalid price')

    const currency = req.body?.currency || 'BSV'
    if (currency !== 'BSV' && currency !== 'MNEE') {
      throw new Error('Invalid currency. Must be BSV or MNEE')
    }

    if (req.body?.endpoint !== undefined && req.body.endpoint !== '') {
      if (typeof req.body.endpoint !== 'string') throw new Error('Invalid endpoint')
      validateServiceEndpoint(req.body.endpoint)
    }

    // endpoint is optional in the job-queue model
    const service = registry.register({ ...req.body, currency })
    res.json({ ok: true, service })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/services', (req, res) => {
  const currencyRaw = typeof req.query.currency === 'string' ? req.query.currency.toUpperCase() : undefined
  const currency = currencyRaw === 'BSV' || currencyRaw === 'MNEE' ? currencyRaw : undefined
  const services = registry.search({
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    keyword: typeof req.query.q === 'string' ? req.query.q : undefined,
    currency,
    maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  })
  res.json({ ok: true, services })
})

app.get('/api/services/:id', (req, res) => {
  const service = registry.getById(String(req.params.id))
  if (!service) return res.status(404).json({ error: 'Service not found' })
  res.json({ ok: true, service })
})

app.patch('/api/services/:id', authMiddleware, (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const existing = registry.getById(String(req.params.id))
  if (!existing) return res.status(404).json({ error: 'Service not found' })
  if (existing.agentId !== auth.id) return res.status(403).json({ error: 'Forbidden' })

  if (req.body?.name !== undefined) {
    if (typeof req.body.name !== 'string' || req.body.name.length < 1 || req.body.name.length > 120) {
      return res.status(400).json({ error: 'Invalid name' })
    }
    if (/<script\b/i.test(req.body.name)) return res.status(400).json({ error: 'Invalid name' })
  }
  if (req.body?.description !== undefined) {
    if (typeof req.body.description !== 'string' || req.body.description.length < 1 || req.body.description.length > 2000) {
      return res.status(400).json({ error: 'Invalid description' })
    }
    if (/<script\b/i.test(req.body.description)) return res.status(400).json({ error: 'Invalid description' })
  }
  if (req.body?.price !== undefined) {
    const price = Number(req.body.price)
    if (!Number.isInteger(price) || price <= 0 || price > 100000000) return res.status(400).json({ error: 'Invalid price' })
  }
  if (req.body?.currency !== undefined) {
    const currency = String(req.body.currency).toUpperCase()
    if (currency !== 'BSV' && currency !== 'MNEE') {
      return res.status(400).json({ error: 'Invalid currency. Must be BSV or MNEE' })
    }
    req.body.currency = currency
  }
  if (req.body?.endpoint !== undefined && req.body.endpoint !== '') {
    if (typeof req.body.endpoint !== 'string') return res.status(400).json({ error: 'Invalid endpoint' })
    try {
      validateServiceEndpoint(req.body.endpoint)
    } catch (e: any) {
      return res.status(400).json({ error: e.message || 'Invalid endpoint' })
    }
  }
  if (req.body?.timeout !== undefined) {
    const timeout = Number(req.body.timeout)
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 600) {
      return res.status(400).json({ error: 'Invalid timeout (5-600 seconds)' })
    }
  }
  if (req.body?.disputeWindow !== undefined) {
    const disputeWindow = Number(req.body.disputeWindow)
    if (!Number.isInteger(disputeWindow) || disputeWindow < 1 || disputeWindow > 4320) {
      return res.status(400).json({ error: 'Invalid disputeWindow (1-4320 minutes)' })
    }
  }

  const service = registry.update(String(req.params.id), req.body)
  res.json({ ok: true, service })
})

// ============ EXECUTE (Pay + Create Job) ============

app.post('/api/execute/:serviceId', authMiddleware, async (req, res) => {
  const { buyerWalletId, input } = req.body
  const auth = (req as any).authWallet as { id: string }

  // Verify the authenticated wallet matches the buyer
  if (buyerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Authenticated wallet does not match buyerWalletId' })
  }

  const service = registry.getById(String(req.params.serviceId))

  if (!service) return res.status(404).json({ error: 'Service not found' })
  if (!service.active) return res.status(400).json({ error: 'Service is inactive' })

  const buyer = wallets.getById(buyerWalletId)
  if (!buyer) return res.status(404).json({ error: 'Buyer wallet not found' })
  const providerWallet = wallets.getById(service.agentId)
  if (!providerWallet) return res.status(404).json({ error: 'Provider wallet not found' })

  const currency = service.currency || 'BSV'
  const inputPayload = input && typeof input === 'object' ? input : {}
  const guardResult = enforcePromptGuard(req, res, inputPayload, 'execute.input')
  if (guardResult.blocked) return

  // Check balance based on currency
  let balance = 0
  if (currency === 'BSV') {
    balance = await wallets.getBalance(buyerWalletId)
  } else if (currency === 'MNEE') {
    balance = await mneeTokens.getBalance(buyer.address)
  }

  if (balance < service.price) {
    return res.status(402).json({
      error: `Insufficient ${currency} balance`,
      required: service.price,
      requiredFormatted: CurrencyManager.format(service.price, currency),
      available: balance,
      availableFormatted: CurrencyManager.format(balance, currency),
      currency,
      address: buyer.address,
    })
  }

  try {
    // Expire any stale jobs opportunistically
    await jobManager.expireStale()

    const buyerPrivKey = wallets.getPrivateKey(buyerWalletId)
    const providerPrivKey = wallets.getPrivateKey(service.agentId)
    if (!buyerPrivKey || !providerPrivKey) {
      return res.status(400).json({
        error: 'Cannot create signed contract because wallet private keys are unavailable',
      })
    }

    const termsHash = hashExecutionTerms(service, inputPayload)
    const contract = await contracts.createAndAnchor({
      serviceId: service.id,
      buyerWalletId,
      providerWalletId: service.agentId,
      buyerAddress: buyer.address,
      providerAddress: providerWallet.address,
      buyerPublicKey: buyer.publicKey,
      providerPublicKey: providerWallet.publicKey,
      buyerPrivateKeyWif: buyerPrivKey,
      providerPrivateKeyWif: providerPrivKey,
      amount: service.price,
      currency,
      termsHash,
      disputeWindow: service.disputeWindow || 30,
    })

    // Create escrowed payment
    const payment = await payments.create(service.id, buyerWalletId, service.agentId, service.price, currency, contract.id)

    // Create pending job (provider will poll for it)
    const timeoutSeconds = service.timeout || 30
    const job = jobManager.create(
      service.id,
      payment.id,
      buyerWalletId,
      service.agentId,
      inputPayload,
      timeoutSeconds
    )

    // Check for expired dispute windows
    disputes.checkExpiredWindows()

    res.json({
      ok: true,
      jobId: job.id,
      paymentId: payment.id,
      status: 'pending',
      expiresAt: job.expiresAt,
      cost: {
        amount: service.price,
        amountFormatted: CurrencyManager.format(service.price, currency),
        platformFee: payment.platformFee,
        platformFeeFormatted: CurrencyManager.format(payment.platformFee, currency),
        currency,
      },
      txId: payment.txId,
      promptGuard: guardResult.score ? { score: guardResult.score } : undefined,
      contract: {
        id: contract.id,
        contractHash: contract.contractHash,
        contractTxId: contract.contractTxId,
        termsHash: contract.termsHash,
        buyerSignature: contract.buyerSignature,
        providerSignature: contract.providerSignature,
      },
    })
  } catch (e: any) {
    res.status(500).json({ error: `Execution failed: ${e.message}` })
  }
})

// ============ JOBS ============

// List jobs (filtered by wallet + status)
app.get('/api/jobs', authMiddleware, async (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const role = typeof req.query.role === 'string' ? req.query.role : undefined
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 100) : 50

  // Expire stale jobs opportunistically
  await jobManager.expireStale()

  let jobs
  if (role === 'buyer') {
    jobs = jobManager.listForBuyer(auth.id, status as any, limit)
  } else if (role === 'provider') {
    jobs = jobManager.listForProvider(auth.id, status as any, limit)
  } else {
    // Return both buyer and provider jobs
    const buyerJobs = jobManager.listForBuyer(auth.id, status as any, limit)
    const providerJobs = jobManager.listForProvider(auth.id, status as any, limit)
    const seen = new Set<string>()
    jobs = []
    for (const j of [...buyerJobs, ...providerJobs]) {
      if (!seen.has(j.id)) {
        seen.add(j.id)
        jobs.push(j)
      }
    }
    jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    jobs = jobs.slice(0, limit)
  }

  res.json({ ok: true, jobs })
})

// Get single job
app.get('/api/jobs/:id', authMiddleware, async (req, res) => {
  const auth = (req as any).authWallet as { id: string }

  // Expire stale jobs opportunistically
  await jobManager.expireStale()

  const job = jobManager.getById(String(req.params.id))
  if (!job) return res.status(404).json({ error: 'Job not found' })

  // Only buyer or provider can read
  if (job.buyerWalletId !== auth.id && job.providerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  res.json({ ok: true, job })
})

// Provider accepts job
app.post('/api/jobs/:id/accept', authMiddleware, (req, res) => {
  const auth = (req as any).authWallet as { id: string }

  try {
    const job = jobManager.accept(String(req.params.id), auth.id)
    res.json({ ok: true, job })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Provider submits result
app.post('/api/jobs/:id/result', authMiddleware, async (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const { output } = req.body

  try {
    const outputPayload = output && typeof output === 'object' ? output : {}
    const guardResult = enforcePromptGuard(req, res, outputPayload, 'jobs.result.output')
    if (guardResult.blocked) return

    const job = await jobManager.submitResult(String(req.params.id), auth.id, outputPayload)
    res.json({ ok: true, job })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Provider reports failure
app.post('/api/jobs/:id/fail', authMiddleware, async (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const { error: errorMsg } = req.body

  try {
    const job = await jobManager.fail(String(req.params.id), auth.id, errorMsg || 'Provider reported failure')
    res.json({ ok: true, job })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ============ PAYMENTS ============

app.get('/api/payments/:id', authMiddleware, (req, res) => {
  const payment = payments.getById(String(req.params.id))
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  
  // Verify user is buyer or seller
  const auth = (req as any).authWallet as { id: string }
  if (payment.buyerWalletId !== auth.id && payment.sellerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  res.json({ ok: true, payment })
})

app.get('/api/payments/:id/settlement-message', authMiddleware, (req, res) => {
  try {
    const payment = payments.getById(String(req.params.id))
    if (!payment) return res.status(404).json({ error: 'Payment not found' })

    const auth = (req as any).authWallet as { id: string }
    if (payment.buyerWalletId !== auth.id && payment.sellerWalletId !== auth.id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const action = parseSettlementAction(req.query.action)
    if (!action) {
      return res.status(400).json({ error: "Invalid action. Must be 'release' or 'refund'" })
    }

    const message = payments.getSettlementMessage(payment.id, action)
    const quorum = payments.getSettlementQuorum(payment.id, action)
    res.json({ ok: true, paymentId: payment.id, action, message, quorum })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/payments/:id/approvals', authMiddleware, (req, res) => {
  try {
    const payment = payments.getById(String(req.params.id))
    if (!payment) return res.status(404).json({ error: 'Payment not found' })

    const auth = (req as any).authWallet as { id: string }
    if (payment.buyerWalletId !== auth.id && payment.sellerWalletId !== auth.id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const action = req.query.action ? parseSettlementAction(req.query.action) : null
    if (req.query.action && !action) {
      return res.status(400).json({ error: "Invalid action. Must be 'release' or 'refund'" })
    }

    const approvals = payments.getSettlementApprovals(payment.id, action || undefined)
    const response: any = { ok: true, paymentId: payment.id, approvals }
    if (action) response.quorum = payments.getSettlementQuorum(payment.id, action)
    res.json(response)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/payments/:id/approvals', authMiddleware, (req, res) => {
  try {
    const payment = payments.getById(String(req.params.id))
    if (!payment) return res.status(404).json({ error: 'Payment not found' })

    const auth = (req as any).authWallet as { id: string }
    if (payment.buyerWalletId !== auth.id && payment.sellerWalletId !== auth.id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const action = parseSettlementAction(req.body?.action)
    if (!action) {
      return res.status(400).json({ error: "Invalid action. Must be 'release' or 'refund'" })
    }

    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : ''
    if (!signature) return res.status(400).json({ error: 'signature is required' })

    const approval = payments.createWalletApproval(payment.id, action, auth.id, signature)
    const quorum = payments.getSettlementQuorum(payment.id, action)
    res.json({ ok: true, approval, quorum })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/payments/:id/dispute', authMiddleware, (req, res) => {
  const paymentRecord = payments.getById(String(req.params.id))
  if (!paymentRecord) return res.status(404).json({ error: 'Payment not found' })
  
  // Verify user is the buyer
  const auth = (req as any).authWallet as { id: string }
  if (paymentRecord.buyerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Only the buyer can dispute this payment' })
  }

  const { reason, evidence } = req.body
  if (!reason || typeof reason !== 'string' || reason.length < 10 || reason.length > 2000) {
    return res.status(400).json({ error: 'Reason required (10-2000 chars)' })
  }
  if (evidence !== undefined && (typeof evidence !== 'string' || evidence.length > 10000)) {
    return res.status(400).json({ error: 'Evidence too long (max 10000 chars)' })
  }

  try {
    const dispute = disputes.create(String(req.params.id), auth.id, reason, evidence)
    res.json({ ok: true, dispute })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ============ CONTRACTS ============

app.get('/api/contracts/:id', authMiddleware, (req, res) => {
  const contract = contracts.getById(String(req.params.id))
  if (!contract) return res.status(404).json({ error: 'Contract not found' })

  const auth = (req as any).authWallet as { id: string }
  const isParty = contract.buyerWalletId === auth.id || contract.providerWalletId === auth.id
  if (!isParty) {
    const isAdmin = isAdminHeaderAuthorized(req)
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden' })

    // Enforce same wallet step-up requirement used by admin endpoints.
    if (ADMIN_WALLET_2FA_REQUIRED) {
      const walletToken = getAdminWalletToken(req)
      if (!walletToken || !getAdminSession(walletToken)) {
        return res.status(403).json({
          error: 'Admin wallet verification required. Provide valid X-Admin-Wallet-Token.',
        })
      }
    }
  }

  res.json({ ok: true, contract })
})

app.get('/api/contracts/:id/verify', (req, res) => {
  const verification = contracts.verifyContract(String(req.params.id))
  if (!verification.contract && !verification.valid) {
    return res.status(404).json({ error: 'Contract not found' })
  }
  res.json({ ok: true, verification })
})

// ============ DISPUTES ============

app.post('/api/disputes', authMiddleware, (req, res) => {
  try {
    const auth = (req as any).authWallet as { id: string }
    const { paymentId, reason, evidence } = req.body

    if (!paymentId || typeof paymentId !== 'string') {
      return res.status(400).json({ error: 'paymentId required' })
    }
    if (!reason || typeof reason !== 'string' || reason.length < 10 || reason.length > 2000) {
      return res.status(400).json({ error: 'Reason required (10-2000 chars)' })
    }
    if (evidence !== undefined && (typeof evidence !== 'string' || evidence.length > 10000)) {
      return res.status(400).json({ error: 'Evidence too long (max 10000 chars)' })
    }

    const dispute = disputes.create(paymentId, auth.id, reason, evidence)
    res.json({ ok: true, dispute })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/disputes/:id', authMiddleware, (req, res) => {
  const dispute = disputes.getById(String(req.params.id))
  if (!dispute) return res.status(404).json({ error: 'Dispute not found' })

  const auth = (req as any).authWallet as { id: string }
  if (dispute.buyerWalletId !== auth.id && dispute.providerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  res.json({ ok: true, dispute })
})

app.get('/api/disputes', authMiddleware, (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  
  const disputesList = disputes.listByWallet(auth.id, status as any)
  res.json({ ok: true, disputes: disputesList })
})

app.post('/api/admin/auth/challenge', requireAdmin, (req, res) => {
  try {
    const requestedAddress = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
    if (requestedAddress && !isAllowedAdminWallet(requestedAddress)) {
      auditAdminAction(req, 'admin.auth.challenge', 'denied', { reason: 'wallet_not_allowlisted', requestedAddress })
      return res.status(403).json({ error: 'Wallet address is not allowlisted for admin access.' })
    }

    if (ADMIN_WALLET_ADDRESSES.length === 0) {
      auditAdminAction(req, 'admin.auth.challenge', 'error', { error: 'admin_wallet_allowlist_not_configured' })
      return res.status(503).json({ error: 'Admin wallet allowlist not configured.' })
    }

    const nonce = crypto.randomBytes(16).toString('hex')
    const expiresAt = new Date(Date.now() + ADMIN_WALLET_CHALLENGE_TTL_SECONDS * 1000).toISOString()
    const challenge = `AgentPay Admin Login\nNonce: ${nonce}\nExpires: ${expiresAt}\nRequestId: ${(req as any).requestId || ''}`

    const db = getDb()
    db.prepare(`
      INSERT INTO admin_auth_challenges (nonce, challenge, requestedAddress, expiresAt)
      VALUES (?, ?, ?, ?)
    `).run(nonce, challenge, requestedAddress || null, expiresAt)

    auditAdminAction(req, 'admin.auth.challenge', 'success', {
      requestedAddress: requestedAddress || null,
      expiresAt,
    })
    res.json({
      ok: true,
      nonce,
      challenge,
      expiresAt,
      ttlSeconds: ADMIN_WALLET_CHALLENGE_TTL_SECONDS,
    })
  } catch (e: any) {
    auditAdminAction(req, 'admin.auth.challenge', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/admin/auth/verify', requireAdmin, (req, res) => {
  try {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce.trim() : ''
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : ''
    const address = typeof req.body?.address === 'string' ? req.body.address.trim() : ''
    if (!nonce || !signature || !address) {
      return res.status(400).json({ error: 'nonce, address, and signature are required' })
    }
    if (!isAllowedAdminWallet(address)) {
      auditAdminAction(req, 'admin.auth.verify', 'denied', { reason: 'wallet_not_allowlisted', address })
      return res.status(403).json({ error: 'Wallet address is not allowlisted for admin access.' })
    }

    const db = getDb()
    const now = new Date().toISOString()
    const challenge = db.prepare(`
      SELECT nonce, challenge, requestedAddress, expiresAt, usedAt
      FROM admin_auth_challenges
      WHERE nonce = ?
    `).get(nonce) as any

    if (!challenge) {
      auditAdminAction(req, 'admin.auth.verify', 'denied', { reason: 'challenge_not_found', nonce })
      return res.status(404).json({ error: 'Challenge not found' })
    }
    if (challenge.usedAt) {
      auditAdminAction(req, 'admin.auth.verify', 'denied', { reason: 'challenge_already_used', nonce })
      return res.status(400).json({ error: 'Challenge already used' })
    }
    if (challenge.expiresAt <= now) {
      auditAdminAction(req, 'admin.auth.verify', 'denied', { reason: 'challenge_expired', nonce })
      return res.status(400).json({ error: 'Challenge expired' })
    }
    if (challenge.requestedAddress && challenge.requestedAddress !== address) {
      auditAdminAction(req, 'admin.auth.verify', 'denied', { reason: 'challenge_address_mismatch', nonce, address })
      return res.status(400).json({ error: 'Address does not match challenge request' })
    }

    const valid = verifyBsmSignatureForAddress(challenge.challenge, signature, address)
    if (!valid) {
      auditAdminAction(req, 'admin.auth.verify', 'denied', { reason: 'invalid_signature', nonce, address })
      return res.status(403).json({ error: 'Invalid wallet signature' })
    }

    db.prepare(`UPDATE admin_auth_challenges SET usedAt = ? WHERE nonce = ?`).run(now, nonce)

    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = hashToken(token)
    const expiresAt = new Date(Date.now() + ADMIN_WALLET_SESSION_MINUTES * 60 * 1000).toISOString()
    db.prepare(`
      INSERT INTO admin_auth_sessions (tokenHash, walletAddress, challengeNonce, expiresAt)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, address, nonce, expiresAt)

    auditAdminAction(req, 'admin.auth.verify', 'success', { address, nonce, expiresAt })
    res.json({
      ok: true,
      walletAddress: address,
      token,
      expiresAt,
      ttlMinutes: ADMIN_WALLET_SESSION_MINUTES,
    })
  } catch (e: any) {
    auditAdminAction(req, 'admin.auth.verify', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/admin/auth/revoke', requireAdmin, (req, res) => {
  try {
    const token = getAdminWalletToken(req)
    if (!token) return res.status(400).json({ error: 'X-Admin-Wallet-Token header required' })

    const db = getDb()
    const result = db.prepare(`
      UPDATE admin_auth_sessions
      SET revokedAt = ?
      WHERE tokenHash = ? AND revokedAt IS NULL
    `).run(new Date().toISOString(), hashToken(token))

    auditAdminAction(req, 'admin.auth.revoke', 'success', { revoked: result.changes > 0 })
    res.json({ ok: true, revoked: result.changes > 0 })
  } catch (e: any) {
    auditAdminAction(req, 'admin.auth.revoke', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/admin/key-rotation/validate', requireAdmin, (req, res) => {
  try {
    const configured = getConfiguredAdminKeys()
    const keyVersion = (req as any).adminAuth?.version || null

    const result = {
      ok: true,
      activeAuth: {
        keyVersion,
        wallet2faRequired: ADMIN_WALLET_2FA_REQUIRED,
        walletAddress: (req as any).adminAuth?.walletAddress || null,
      },
      rotation: {
        currentConfigured: !!process.env.AGENTPAY_MASTER_KEY_CURRENT,
        previousConfigured: !!process.env.AGENTPAY_MASTER_KEY_PREVIOUS,
        legacyConfigured: !!process.env.AGENTPAY_MASTER_KEY,
        totalAcceptedKeys: configured.length,
      },
      recommendations: [] as string[],
    }

    if (!process.env.AGENTPAY_MASTER_KEY_CURRENT) {
      result.recommendations.push('Set AGENTPAY_MASTER_KEY_CURRENT for explicit active key management.')
    }
    if (!process.env.AGENTPAY_MASTER_KEY_PREVIOUS) {
      result.recommendations.push('Set AGENTPAY_MASTER_KEY_PREVIOUS during rotations to avoid downtime.')
    }
    if (process.env.AGENTPAY_MASTER_KEY) {
      result.recommendations.push('Remove legacy AGENTPAY_MASTER_KEY once CURRENT/PREVIOUS rotation is stable.')
    }

    auditAdminAction(req, 'admin.keys.validate', 'success', { keyVersion })
    res.json(result)
  } catch (e: any) {
    auditAdminAction(req, 'admin.keys.validate', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/admin/payments/:id/settlement-message', requireAdmin, (req, res) => {
  try {
    const payment = payments.getById(String(req.params.id))
    if (!payment) return res.status(404).json({ error: 'Payment not found' })

    const action = parseSettlementAction(req.query.action)
    if (!action) {
      return res.status(400).json({ error: "Invalid action. Must be 'release' or 'refund'" })
    }

    const message = payments.getSettlementMessage(payment.id, action)
    const quorum = payments.getSettlementQuorum(payment.id, action)
    const multisigSigningPayload = payments.getAdminMultisigSigningPayload(payment.id, action)
    const adminMultisigPublicKey = process.env.AGENTPAY_ADMIN_MULTISIG_PUBKEY || null
    auditAdminAction(req, 'admin.payments.settlement_message.get', 'success', { paymentId: payment.id, action })
    res.json({
      ok: true,
      paymentId: payment.id,
      action,
      message,
      walletAddress: (req as any).adminAuth?.walletAddress || null,
      quorum,
      multisigSigningPayload,
      adminMultisigPublicKey,
    })
  } catch (e: any) {
    auditAdminAction(req, 'admin.payments.settlement_message.get', 'error', { error: e.message }, String(req.params.id))
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/admin/multisig/normalize-signature', requireAdmin, (req, res) => {
  try {
    const signature = typeof req.body?.signature === 'string' ? req.body.signature : ''
    const sighashType = Number.isInteger(req.body?.sighashType) ? Number(req.body.sighashType) : undefined
    const digestHex = typeof req.body?.digestHex === 'string' ? req.body.digestHex.trim() : undefined
    const publicKeyHex = typeof req.body?.publicKeyHex === 'string'
      ? req.body.publicKeyHex.trim()
      : (process.env.AGENTPAY_ADMIN_MULTISIG_PUBKEY || undefined)

    const normalized = normalizeTxSignatureToChecksigHex(signature, {
      sighashType,
      digestHex,
      publicKeyHex,
    })
    auditAdminAction(req, 'admin.multisig.normalize_signature', 'success', {
      detectedFormat: normalized.detectedFormat,
      scope: normalized.scope,
      verified: normalized.verified,
    })
    res.json({ ok: true, ...normalized })
  } catch (e: any) {
    auditAdminAction(req, 'admin.multisig.normalize_signature', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/admin/metrics', requireAdmin, (req, res) => {
  try {
    const db = getDb()
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    const openDisputes = (db.prepare(`SELECT COUNT(*) as c FROM disputes WHERE status = 'open'`).get() as any).c || 0
    const resolved24h = (db.prepare(`
      SELECT COUNT(*) as c FROM disputes
      WHERE status IN ('resolved_refund', 'resolved_release', 'resolved_split') AND resolvedAt >= ?
    `).get(last24h) as any).c || 0

    const paymentsByStatus = db.prepare(`
      SELECT status, COUNT(*) as c FROM payments GROUP BY status
    `).all() as any[]
    const paymentStatusMap: Record<string, number> = {}
    for (const row of paymentsByStatus) paymentStatusMap[row.status] = row.c

    const settlementFailures24h = (db.prepare(`
      SELECT COUNT(*) as c FROM admin_audit_logs
      WHERE action = 'admin.disputes.resolve' AND status = 'error' AND createdAt >= ?
    `).get(last24h) as any).c || 0

    const adminAuthDenied1h = (db.prepare(`
      SELECT COUNT(*) as c FROM admin_audit_logs
      WHERE action = 'admin.auth' AND status = 'denied' AND createdAt >= ?
    `).get(oneHourAgo) as any).c || 0

    const walletSessionsActive = (db.prepare(`
      SELECT COUNT(*) as c FROM admin_auth_sessions
      WHERE revokedAt IS NULL AND expiresAt > ?
    `).get(now.toISOString()) as any).c || 0

    const x402Consumed = (db.prepare(`
      SELECT COUNT(*) as c FROM payments WHERE x402ConsumedAt IS NOT NULL
    `).get() as any).c || 0

    const metrics = {
      timestamp: now.toISOString(),
      disputes: {
        open: openDisputes,
        resolved24h,
      },
      payments: {
        byStatus: paymentStatusMap,
      },
      security: {
        adminAuthDenied1h,
        settlementFailures24h,
        walletSessionsActive,
      },
      x402: {
        consumedPayments: x402Consumed,
      },
    }

    auditAdminAction(req, 'admin.metrics.get', 'success', {
      openDisputes,
      adminAuthDenied1h,
      settlementFailures24h,
    })
    res.json({ ok: true, metrics })
  } catch (e: any) {
    auditAdminAction(req, 'admin.metrics.get', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/admin/disputes', requireAdmin, (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const disputesList = disputes.listAll(status as any)
    auditAdminAction(req, 'admin.disputes.list', 'success', { status: status || null, count: disputesList.length })
    res.json({ ok: true, disputes: disputesList, count: disputesList.length })
  } catch (e: any) {
    auditAdminAction(req, 'admin.disputes.list', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/admin/disputes/:id', requireAdmin, (req, res) => {
  const dispute = disputes.getById(String(req.params.id))
  if (!dispute) {
    auditAdminAction(req, 'admin.disputes.get', 'error', { error: 'dispute_not_found' }, String(req.params.id))
    return res.status(404).json({ error: 'Dispute not found' })
  }
  auditAdminAction(req, 'admin.disputes.get', 'success', undefined, String(req.params.id))
  res.json({ ok: true, dispute })
})

app.get('/api/admin/disputes/:id/resolve-payload', requireAdmin, (req, res) => {
  try {
    const disputeId = String(req.params.id)
    const action = parseSettlementAction(req.query.action)
    if (!action) {
      return res.status(400).json({ error: "Invalid action. Must be 'release' or 'refund'" })
    }

    const dispute = disputes.getById(disputeId)
    if (!dispute) {
      auditAdminAction(req, 'admin.disputes.resolve_payload.get', 'error', { error: 'dispute_not_found', action }, disputeId)
      return res.status(404).json({ error: 'Dispute not found' })
    }

    const payment = payments.getById(dispute.paymentId)
    if (!payment) {
      auditAdminAction(req, 'admin.disputes.resolve_payload.get', 'error', { error: 'payment_not_found', action }, disputeId)
      return res.status(404).json({ error: 'Payment not found for dispute' })
    }

    const settlementMessage = payments.getSettlementMessage(payment.id, action)
    const multisigSigningPayload = payments.getAdminMultisigSigningPayload(payment.id, action)
    const quorum = payments.getSettlementQuorum(payment.id, action)

    auditAdminAction(req, 'admin.disputes.resolve_payload.get', 'success', {
      disputeId,
      paymentId: payment.id,
      action,
      hasMultisigPayload: !!multisigSigningPayload,
    }, disputeId)

    res.json({
      ok: true,
      disputeId,
      paymentId: payment.id,
      action,
      settlementMessage,
      multisigSigningPayload,
      adminMultisigPublicKey: process.env.AGENTPAY_ADMIN_MULTISIG_PUBKEY || null,
      quorum,
    })
  } catch (e: any) {
    auditAdminAction(req, 'admin.disputes.resolve_payload.get', 'error', { error: e.message }, String(req.params.id))
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/admin/audit-logs', requireAdmin, (req, res) => {
  try {
    const action = typeof req.query.action === 'string' ? req.query.action : undefined
    const status = typeof req.query.status === 'string' ? req.query.status : undefined
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset) || 0, 0)

    const db = getDb()
    const conditions: string[] = []
    const params: any[] = []

    if (action) {
      conditions.push('action = ?')
      params.push(action)
    }
    if (status) {
      conditions.push('status = ?')
      params.push(status)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const countRow = db.prepare(`SELECT COUNT(*) as total FROM admin_audit_logs ${whereClause}`).get(...params) as { total: number }
    const logs = db.prepare(`
      SELECT id, action, status, adminKeyVersion, disputeId, ip, userAgent, details, createdAt
      FROM admin_audit_logs
      ${whereClause}
      ORDER BY createdAt DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)

    auditAdminAction(req, 'admin.audit.list', 'success', {
      action: action || null,
      status: status || null,
      limit,
      offset,
      count: logs.length,
    })
    res.json({ ok: true, logs, total: countRow.total, limit, offset })
  } catch (e: any) {
    auditAdminAction(req, 'admin.audit.list', 'error', { error: e.message })
    res.status(400).json({ error: e.message })
  }
})

const resolveDisputeAsAdmin = async (req: express.Request, res: express.Response) => {
  try {
    const { resolution, splitPercent } = req.body
    const disputeId = String(req.params.id)

    if (!resolution || !['refund', 'release', 'split'].includes(resolution)) {
      auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'invalid_resolution', resolution }, disputeId)
      return res.status(400).json({ error: 'Invalid resolution. Must be: refund, release, or split' })
    }

    const existing = disputes.getById(disputeId)
    if (!existing) {
      auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'dispute_not_found', resolution }, disputeId)
      return res.status(404).json({ error: 'Dispute not found' })
    }

    // Settlement must succeed before dispute can be marked resolved.
    let settledPayment = payments.getById(existing.paymentId)
    if (!settledPayment) {
      auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'payment_not_found', resolution }, disputeId)
      return res.status(404).json({ error: 'Payment for dispute not found' })
    }

    if (resolution === 'split') {
      auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'split_not_implemented' }, disputeId)
      return res.status(501).json({
        error: 'Split settlement not implemented yet. Use refund or release.',
      })
    }

    if (resolution === 'refund') {
      if (settledPayment.status !== 'refunded') {
        const adminAddress = (req as any).adminAuth?.walletAddress as string | undefined
        if (!adminAddress) {
          auditAdminAction(req, 'admin.disputes.resolve', 'denied', { reason: 'admin_wallet_session_required' }, disputeId)
          return res.status(403).json({
            error: 'Admin wallet session required to sign settlement. Provide X-Admin-Wallet-Token.',
          })
        }
        const action = 'refund' as const
        const settlementMessage = payments.getSettlementMessage(existing.paymentId, action)
        const adminSignature = typeof req.body?.adminSignature === 'string' ? req.body.adminSignature.trim() : ''
        if (!adminSignature) {
          return res.status(400).json({
            error: 'adminSignature is required for refund settlement',
            paymentId: existing.paymentId,
            action,
            settlementMessage,
          })
        }
        if (!verifyBsmSignatureForAddress(settlementMessage, adminSignature, adminAddress)) {
          auditAdminAction(req, 'admin.disputes.resolve', 'denied', { reason: 'invalid_admin_settlement_signature', action }, disputeId)
          return res.status(403).json({ error: 'Invalid admin settlement signature' })
        }
        payments.createAdminApproval(existing.paymentId, action, adminAddress, adminSignature)

        let refundOpts: { adminTxSignatureHex?: string } | undefined
        if (settledPayment.currency === 'BSV' && (settledPayment.escrowMode || 'platform') === 'multisig') {
          const rawAdminTxSignature = typeof req.body?.adminTxSignatureHex === 'string' ? req.body.adminTxSignatureHex.trim() : ''
          if (!rawAdminTxSignature) {
            return res.status(400).json({
              error: 'adminTxSignatureHex is required for multisig refund settlement',
              paymentId: existing.paymentId,
              action,
              multisigSigningPayload: payments.getAdminMultisigSigningPayload(existing.paymentId, action),
            })
          }
          const signingPayload = payments.getAdminMultisigSigningPayload(existing.paymentId, action)
          if (!signingPayload) {
            return res.status(400).json({ error: 'Unable to build multisig signing payload for refund' })
          }
          const normalized = normalizeTxSignatureToChecksigHex(rawAdminTxSignature, {
            sighashType: signingPayload.sighashType,
            digestHex: signingPayload.digestHex,
            publicKeyHex: process.env.AGENTPAY_ADMIN_MULTISIG_PUBKEY,
          })
          refundOpts = { adminTxSignatureHex: normalized.checksigHex }
        }

        const refunded = await payments.refund(existing.paymentId, refundOpts)
        if (!refunded) {
          auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'refund_failed', paymentStatus: settledPayment.status }, disputeId)
          return res.status(400).json({
            error: `Cannot refund payment in status '${settledPayment.status}'`,
          })
        }
        settledPayment = refunded
      }
    } else if (resolution === 'release') {
      if (settledPayment.status !== 'released') {
        const adminAddress = (req as any).adminAuth?.walletAddress as string | undefined
        if (!adminAddress) {
          auditAdminAction(req, 'admin.disputes.resolve', 'denied', { reason: 'admin_wallet_session_required' }, disputeId)
          return res.status(403).json({
            error: 'Admin wallet session required to sign settlement. Provide X-Admin-Wallet-Token.',
          })
        }
        const action = 'release' as const
        const settlementMessage = payments.getSettlementMessage(existing.paymentId, action)
        const adminSignature = typeof req.body?.adminSignature === 'string' ? req.body.adminSignature.trim() : ''
        if (!adminSignature) {
          return res.status(400).json({
            error: 'adminSignature is required for release settlement',
            paymentId: existing.paymentId,
            action,
            settlementMessage,
          })
        }
        if (!verifyBsmSignatureForAddress(settlementMessage, adminSignature, adminAddress)) {
          auditAdminAction(req, 'admin.disputes.resolve', 'denied', { reason: 'invalid_admin_settlement_signature', action }, disputeId)
          return res.status(403).json({ error: 'Invalid admin settlement signature' })
        }
        payments.createAdminApproval(existing.paymentId, action, adminAddress, adminSignature)

        let releaseOpts: { adminTxSignatureHex?: string } | undefined
        if (settledPayment.currency === 'BSV' && (settledPayment.escrowMode || 'platform') === 'multisig') {
          const rawAdminTxSignature = typeof req.body?.adminTxSignatureHex === 'string' ? req.body.adminTxSignatureHex.trim() : ''
          if (!rawAdminTxSignature) {
            return res.status(400).json({
              error: 'adminTxSignatureHex is required for multisig release settlement',
              paymentId: existing.paymentId,
              action,
              multisigSigningPayload: payments.getAdminMultisigSigningPayload(existing.paymentId, action),
            })
          }
          const signingPayload = payments.getAdminMultisigSigningPayload(existing.paymentId, action)
          if (!signingPayload) {
            return res.status(400).json({ error: 'Unable to build multisig signing payload for release' })
          }
          const normalized = normalizeTxSignatureToChecksigHex(rawAdminTxSignature, {
            sighashType: signingPayload.sighashType,
            digestHex: signingPayload.digestHex,
            publicKeyHex: process.env.AGENTPAY_ADMIN_MULTISIG_PUBKEY,
          })
          releaseOpts = { adminTxSignatureHex: normalized.checksigHex }
        }

        const released = await payments.release(existing.paymentId, releaseOpts)
        if (!released) {
          auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'release_failed', paymentStatus: settledPayment.status }, disputeId)
          return res.status(400).json({
            error: `Cannot release payment in status '${settledPayment.status}'`,
          })
        }
        settledPayment = released
      }
    }

    const dispute = disputes.resolve(disputeId, { resolution, splitPercent })
    if (!dispute) {
      auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: 'resolve_state_failed', resolution }, disputeId)
      return res.status(404).json({ error: 'Dispute not found' })
    }

    auditAdminAction(
      req,
      'admin.disputes.resolve',
      'success',
      {
        resolution,
        paymentId: settledPayment.id,
        paymentStatus: settledPayment.status,
        refundQuorum: payments.getSettlementQuorum(settledPayment.id, 'refund'),
        releaseQuorum: payments.getSettlementQuorum(settledPayment.id, 'release'),
      },
      disputeId
    )
    res.json({
      ok: true,
      dispute,
      payment: settledPayment,
      quorum: {
        refund: payments.getSettlementQuorum(settledPayment.id, 'refund'),
        release: payments.getSettlementQuorum(settledPayment.id, 'release'),
      },
    })
  } catch (e: any) {
    auditAdminAction(req, 'admin.disputes.resolve', 'error', { error: e.message }, String(req.params.id))
    res.status(400).json({ error: e.message })
  }
}

// Backward-compatible route + explicit admin namespace
app.post('/api/disputes/:id/resolve', adminRateLimit, requireAdmin, resolveDisputeAsAdmin)
app.post('/api/admin/disputes/:id/resolve', adminRateLimit, requireAdmin, resolveDisputeAsAdmin)

// ============ REPUTATION ============

app.get('/api/agents/:id/reputation', (req, res) => {
  const reputation = registry.getReputation(String(req.params.id))
  res.json({ ok: true, reputation })
})

// ============ WALLET UTXOS ============

app.get('/api/wallets/:id/utxos', async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) return res.status(401).json({ error: 'API key required' })
  if (!wallets.verifyApiKey(String(req.params.id), apiKey)) return res.status(403).json({ error: 'Forbidden' })

  const wallet = wallets.getById(String(req.params.id))
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  try {
    const utxos = await wallets.getUtxos(String(req.params.id))
    res.json({ ok: true, utxos })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ============ WALLET TX HISTORY ============

app.get('/api/wallets/:id/transactions', async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) return res.status(401).json({ error: 'API key required' })
  if (!wallets.verifyApiKey(String(req.params.id), apiKey)) return res.status(403).json({ error: 'Forbidden' })

  const wallet = wallets.getById(String(req.params.id))
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  try {
    const transactions = await wallets.getTxHistory(String(req.params.id))
    res.json({ ok: true, transactions })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ============ EXECUTIONS (purchase history) ============

app.get('/api/wallets/:id/executions', authMiddleware, requireWalletMatch, (req, res) => {
  try {
    const walletId = String(req.params.id)
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100)
    const offset = Math.max(Number(req.query.offset) || 0, 0)
    const status = typeof req.query.status === 'string' ? req.query.status : undefined

    const db = getDb()

    let whereClause = 'WHERE p.buyerWalletId = ?'
    const params: any[] = [walletId]

    if (status) {
      whereClause += ' AND p.status = ?'
      params.push(status)
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM payments p ${whereClause}`
    ).get(...params) as { total: number }

    const executions = db.prepare(
      `SELECT
        p.id as paymentId,
        p.serviceId,
        s.name as serviceName,
        p.amount,
        p.currency,
        p.status,
        p.platformFee,
        p.createdAt,
        p.completedAt,
        r.executionTimeMs,
        r.receiptHash,
        d.id as disputeId,
        d.status as disputeStatus
      FROM payments p
      LEFT JOIN services s ON p.serviceId = s.id
      LEFT JOIN execution_receipts r ON p.id = r.paymentId
      LEFT JOIN disputes d ON p.id = d.paymentId
      ${whereClause}
      ORDER BY p.createdAt DESC
      LIMIT ? OFFSET ?`
    ).all(...params, limit, offset)

    res.json({ ok: true, executions, total: countRow.total, limit, offset })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ============ FUND (testnet/demo only) ============

app.post('/api/wallets/:id/fund', authMiddleware, requireWalletMatch, async (req, res) => {
  // In real mode, users send BSV directly to the wallet address
  if (!isDemoMode) {
    const wallet = wallets.getById(String(req.params.id))
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
    return res.status(400).json({
      error: 'Demo funding disabled in production mode',
      message: 'Send real BSV to your wallet address to fund it',
      address: wallet.address,
      network: process.env.BSV_NETWORK || 'mainnet',
    })
  }

  const { amount } = req.body
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Invalid amount' })

  const wallet = wallets.getById(String(req.params.id))
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  const db = getDb()
  db.prepare(`INSERT INTO deposits (walletId, amount, currency) VALUES (?, ?, 'BSV')`).run(
    String(req.params.id),
    amount,
  )

  const balance = await wallets.getBalance(String(req.params.id))
  res.json({ ok: true, funded: amount, balance, mode: 'demo-ledger' })
})

// ============ WEBHOOKS ============

app.post('/api/webhooks', authMiddleware, (req, res) => {
  try {
    const auth = (req as any).authWallet as { id: string }
    const { url, events } = req.body

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid URL required' })
    }

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'At least one event required' })
    }

    const webhook = webhooks.register({ url, events, ownerId: auth.id })
    res.json({ ok: true, webhook })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/webhooks', authMiddleware, (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const webhookList = webhooks.list(auth.id)
  res.json({ ok: true, webhooks: webhookList })
})

app.put('/api/webhooks/:id', authMiddleware, (req, res) => {
  try {
    const auth = (req as any).authWallet as { id: string }
    const { url, events, active } = req.body

    const updates: any = {}
    if (url !== undefined) {
      if (typeof url !== 'string') {
        return res.status(400).json({ error: 'URL must be a string' })
      }
      updates.url = url
    }
    if (events !== undefined) {
      if (!Array.isArray(events)) {
        return res.status(400).json({ error: 'Events must be an array' })
      }
      updates.events = events
    }
    if (active !== undefined) updates.active = active

    const webhook = webhooks.update(String(req.params.id), updates, auth.id)
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' })

    res.json({ ok: true, webhook })
  } catch (e: any) {
    if (e?.message === 'Forbidden') return res.status(403).json({ error: 'Forbidden' })
    res.status(400).json({ error: e.message })
  }
})

app.delete('/api/webhooks/:id', authMiddleware, (req, res) => {
  try {
    const auth = (req as any).authWallet as { id: string }
    const deleted = webhooks.delete(req.params.id as string, auth.id)
    if (!deleted) return res.status(404).json({ error: 'Webhook not found' })
    res.json({ ok: true })
  } catch (e: any) {
    if (e?.message === 'Forbidden') return res.status(403).json({ error: 'Forbidden' })
    res.status(400).json({ error: e.message })
  }
})

// ============ RECEIPTS (Execution Verification) ============

app.get('/api/receipts/:paymentId', (req, res) => {
  try {
    const receipt = verification.getReceipt(String(req.params.paymentId))
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' })
    }
    res.json({ ok: true, receipt })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/receipts/:paymentId/verify', async (req, res) => {
  try {
    const receipt = verification.getReceipt(String(req.params.paymentId))
    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' })
    }

    const result = await verification.verifyReceipt(receipt)
    res.json({
      ok: true,
      verification: result,
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ============ HEALTH ============

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agentpay', version: '0.2.0' })
})

// JSON parse error handler (avoid stack traces)
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' })
  }
  if (err instanceof SyntaxError && 'body' in (err as any)) {
    return res.status(400).json({ error: 'Invalid JSON' })
  }
  return next(err)
})

// ============ AGENT IDENTITY ============

// Register identity for a wallet
app.post('/api/identity', authMiddleware, async (req, res) => {
  const auth = (req as any).authWallet as { id: string; address: string }
  const { displayName, type, capabilities, metadata, anchorOnChain } = req.body

  if (!displayName) return res.status(400).json({ error: 'displayName required' })

  try {
    let privateKeyWif: string | undefined
    if (anchorOnChain) {
      privateKeyWif = wallets.getPrivateKey(auth.id) || undefined
    }

    const identity = await identityManager.register(
      auth.id, auth.address, displayName,
      type || 'agent', capabilities || [], metadata || {},
      anchorOnChain, privateKeyWif
    )
    res.json({ ok: true, identity })
  } catch (err: any) {
    res.status(400).json({ error: err.message })
  }
})

// Get identity by address
app.get('/api/identity/:address', (req, res) => {
  const identity = identityManager.getByAddress(req.params.address)
  if (!identity) return res.status(404).json({ error: 'Identity not found' })
  const attestations = identityManager.getAttestations(req.params.address)
  res.json({ ok: true, identity, attestations })
})

// Update identity
app.patch('/api/identity', authMiddleware, (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const { displayName, capabilities, metadata } = req.body

  const identity = identityManager.update(auth.id, { displayName, capabilities, metadata })
  if (!identity) return res.status(404).json({ error: 'Identity not found' })
  res.json({ ok: true, identity })
})

// Create attestation (rate another agent)
app.post('/api/identity/:address/attest', authMiddleware, async (req, res) => {
  const auth = (req as any).authWallet as { id: string; address: string }
  const { score, comment, anchorOnChain } = req.body
  const toAddress = String(req.params.address)

  if (!score || score < 1 || score > 5) return res.status(400).json({ error: 'Score must be 1-5' })
  if (auth.address === toAddress) return res.status(400).json({ error: 'Cannot attest yourself' })

  try {
    let privateKeyWif: string | undefined
    if (anchorOnChain) {
      privateKeyWif = wallets.getPrivateKey(auth.id) || undefined
    }

    const attestation = await identityManager.attest(
      auth.address, toAddress, score, comment || '', privateKeyWif
    )
    res.json({ ok: true, attestation })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Search identities
app.get('/api/identities', (req, res) => {
  const { q, type } = req.query
  const identities = identityManager.search(q as string, type as string)
  res.json({ ok: true, identities, count: identities.length })
})

// ============ x402 PROTOCOL ============

const PLATFORM_ADDRESS = process.env.PLATFORM_WALLET_ADDRESS || ''
const BSV_NETWORK = process.env.BSV_NETWORK || 'testnet'

/**
 * x402 Service Discovery
 * GET /api/x402/services/:id
 * 
 * Without X-Payment-Receipt → returns 402 with payment terms
 * With X-Payment-Receipt → executes and returns result
 */
app.get('/api/x402/services/:id', async (req, res) => {
  const service = registry.getById(String(req.params.id))
  if (!service) return res.status(404).json({ error: 'Service not found' })
  if (!service.active) return res.status(400).json({ error: 'Service is inactive' })

  // Check for payment receipt
  const receipt = parsePaymentReceipt(req)

  if (!receipt) {
    // No payment → return 402 with payment terms (x402 standard)
    const paymentRequired = buildPaymentRequired(service, PLATFORM_ADDRESS, BSV_NETWORK)
    return res.status(402).json(paymentRequired)
  }

  // Has payment receipt → verify and return result
  try {
    const db = getDb()
    let payment: any = null

    if (receipt.paymentId) {
      payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(receipt.paymentId)
    }
    if (!payment && receipt.txid) {
      payment = db.prepare('SELECT * FROM payments WHERE txId = ? OR escrowTxId = ?').get(receipt.txid, receipt.txid)
    }

    if (!payment) {
      return res.status(402).json({
        error: 'Payment not found or not yet confirmed',
        ...buildPaymentRequired(service, PLATFORM_ADDRESS, BSV_NETWORK),
      })
    }

    if (payment.status !== 'released' && payment.status !== 'escrowed') {
      return res.status(402).json({
        error: `Payment status: ${payment.status}. Expected: released or escrowed.`,
        paymentId: payment.id,
      })
    }

    if (!receipt.walletId || receipt.walletId !== payment.buyerWalletId) {
      return res.status(402).json({
        error: 'Invalid payment receipt wallet binding',
        paymentId: payment.id,
      })
    }

    const expectedCurrency = service.currency || 'BSV'
    const paymentCurrency = payment.currency || 'BSV'
    if (payment.serviceId !== service.id || payment.amount !== service.price || paymentCurrency !== expectedCurrency) {
      return res.status(402).json({
        error: 'Payment does not match service terms',
        ...buildPaymentRequired(service, PLATFORM_ADDRESS, BSV_NETWORK),
      })
    }

    // Payment verified — return service info (actual execution is via /api/execute)
    res.json({
      ok: true,
      'x-402-version': '1.0',
      service: {
        id: service.id,
        name: service.name,
        description: service.description,
      },
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency || 'BSV',
      },
      message: 'Payment verified. Use POST /api/x402/services/:id/execute with X-Payment-Receipt to execute.',
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Payment verification failed: ' + err.message })
  }
})

/**
 * x402 Protected Execution
 * POST /api/x402/services/:id/execute
 *
 * Requires a valid X-Payment-Receipt bound to buyer wallet.
 * Prevents replay by consuming each escrow payment only once.
 */
app.post('/api/x402/services/:id/execute', async (req, res) => {
  const service = registry.getById(String(req.params.id))
  if (!service) return res.status(404).json({ error: 'Service not found' })
  if (!service.active) return res.status(400).json({ error: 'Service is inactive' })

  const receipt = parsePaymentReceipt(req)
  if (!receipt) {
    return res.status(402).json(buildPaymentRequired(service, PLATFORM_ADDRESS, BSV_NETWORK))
  }

  try {
    await jobManager.expireStale()

    const db = getDb()
    let payment: any = null

    if (receipt.paymentId) {
      payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(receipt.paymentId)
    }
    if (!payment && receipt.txid) {
      payment = db.prepare('SELECT * FROM payments WHERE txId = ? OR escrowTxId = ?').get(receipt.txid, receipt.txid)
    }

    if (!payment) {
      return res.status(402).json({
        error: 'Payment not found or not yet confirmed',
        ...buildPaymentRequired(service, PLATFORM_ADDRESS, BSV_NETWORK),
      })
    }

    if (payment.status !== 'escrowed') {
      return res.status(402).json({
        error: `Payment status ${payment.status} cannot be used for execution`,
        paymentId: payment.id,
      })
    }

    if (!receipt.walletId || receipt.walletId !== payment.buyerWalletId) {
      return res.status(402).json({
        error: 'Invalid payment receipt wallet binding',
        paymentId: payment.id,
      })
    }

    const expectedCurrency = service.currency || 'BSV'
    const paymentCurrency = payment.currency || 'BSV'
    if (payment.serviceId !== service.id || payment.amount !== service.price || paymentCurrency !== expectedCurrency) {
      return res.status(402).json({
        error: 'Payment does not match service terms',
        ...buildPaymentRequired(service, PLATFORM_ADDRESS, BSV_NETWORK),
      })
    }

    // Replay-safe: if already consumed, return existing job info.
    if (payment.x402ConsumedAt && payment.x402JobId) {
      const existingJob = jobManager.getById(payment.x402JobId)
      return res.json({
        ok: true,
        replay: true,
        jobId: payment.x402JobId,
        paymentId: payment.id,
        status: existingJob?.status || 'pending',
        expiresAt: existingJob?.expiresAt,
      })
    }

    // Idempotency guard for payments that already have a job (e.g., created via /api/execute).
    const existingByPayment = db.prepare(`
      SELECT id FROM jobs WHERE paymentId = ? LIMIT 1
    `).get(payment.id) as { id: string } | undefined
    if (existingByPayment?.id) {
      const existingJob = jobManager.getById(existingByPayment.id)
      db.prepare(`UPDATE payments SET x402ConsumedAt = COALESCE(x402ConsumedAt, ?), x402JobId = COALESCE(x402JobId, ?) WHERE id = ?`)
        .run(new Date().toISOString(), existingByPayment.id, payment.id)
      return res.json({
        ok: true,
        replay: true,
        reusedExistingJob: true,
        jobId: existingByPayment.id,
        paymentId: payment.id,
        status: existingJob?.status || 'pending',
        expiresAt: existingJob?.expiresAt,
      })
    }

    const timeoutSeconds = service.timeout || 30
    const input = req.body?.input && typeof req.body.input === 'object' ? req.body.input : {}
    const guardResult = enforcePromptGuard(req, res, input, 'x402.execute.input')
    if (guardResult.blocked) return
    const job = jobManager.create(
      service.id,
      payment.id,
      payment.buyerWalletId,
      service.agentId,
      input,
      timeoutSeconds
    )

    db.prepare(`UPDATE payments SET x402ConsumedAt = ?, x402JobId = ? WHERE id = ?`)
      .run(new Date().toISOString(), job.id, payment.id)

    disputes.checkExpiredWindows()

    res.json({
      ok: true,
      jobId: job.id,
      paymentId: payment.id,
      status: 'pending',
      expiresAt: job.expiresAt,
      cost: {
        amount: service.price,
        amountFormatted: CurrencyManager.format(service.price, expectedCurrency),
        platformFee: payment.platformFee,
        platformFeeFormatted: CurrencyManager.format(payment.platformFee, expectedCurrency),
        currency: expectedCurrency,
      },
      txId: payment.txId || payment.escrowTxId,
      promptGuard: guardResult.score ? { score: guardResult.score } : undefined,
    })
  } catch (err: any) {
    res.status(500).json({ error: 'x402 execution failed: ' + err.message })
  }
})

/**
 * x402 Service Catalog
 * GET /api/x402/services
 * 
 * Returns all available services with x402 payment terms
 */
app.get('/api/x402/services', (_req, res) => {
  const services = registry.search({})
  const catalog = services.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    price: s.price,
    currency: s.currency || 'BSV',
    priceFormatted: (s.currency || 'BSV') === 'BSV'
      ? `${s.price} sats`
      : `$${(s.price / 100).toFixed(2)} MNEE`,
    endpoint: `/api/x402/services/${s.id}`,
    payment: {
      network: BSV_NETWORK === 'mainnet' ? 'bsv-mainnet' : 'bsv-testnet',
      recipient: PLATFORM_ADDRESS,
      memo: `agentpay:${s.id}`,
    },
    active: s.active,
  }))

  res.json({
    'x-402-version': '1.0',
    protocol: 'agentpay-x402',
    network: BSV_NETWORK,
    services: catalog,
    count: catalog.length,
  })
})

/**
 * x402 Payment Info
 * GET /api/x402/info
 * 
 * Protocol metadata for agent discovery
 */
app.get('/api/x402/info', (_req, res) => {
  res.json({
    'x-402-version': '1.0',
    protocol: 'agentpay-x402',
    name: 'AgentPay',
    description: 'AI Agent-to-Agent Micropayment Marketplace on BSV',
    network: BSV_NETWORK,
    platformAddress: PLATFORM_ADDRESS,
    currencies: ['BSV', 'MNEE'],
    fee: '2%',
    endpoints: {
      catalog: '/api/x402/services',
      service: '/api/x402/services/:id',
      executeProtected: '/api/x402/services/:id/execute',
      execute: '/api/execute/:serviceId',
      info: '/api/x402/info',
    },
    capabilities: [
      'micropayments',
      'multi-currency',
      'escrow',
      'dispute-resolution',
      'execution-verification',
      'webhooks',
    ],
  })
})

// Global error handler - NEVER expose stack traces in production
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  
  // In demo mode, return error message (but never stack traces)
  if (process.env.AGENTPAY_DEMO === 'true') {
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
  
  // In production, only return generic error
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = Number(process.env.PORT) || 3100

export function startServer() {
  app.listen(PORT, () => {
    console.log(`🚀 AgentPay API running on http://localhost:${PORT}`)
    console.log(`📚 API Docs: http://localhost:${PORT}/docs`)
    console.log(`📋 Registry: GET /api/services`)
    console.log(`💰 Execute:  POST /api/execute/:serviceId`)
    console.log(`👛 Wallets:  POST /api/wallets`)
  })
  return app
}

export { app }

// Auto-start server
startServer()
