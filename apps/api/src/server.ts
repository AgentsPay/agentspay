import { config as dotenvConfig } from 'dotenv'
import { resolve } from 'path'
// Load .env from monorepo root
dotenvConfig({ path: resolve(process.cwd(), '.env') })

process.on('uncaughtException', (err) => { console.error('UNCAUGHT:', err); })
process.on('unhandledRejection', (err) => { console.error('UNHANDLED:', err); })

import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
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
  validateServiceEndpoint,
  AgentIdentityManager,
} from '@agentspay/core'
import { setupSwagger } from './docs/swagger'
import { requireApiKey, requireWalletMatch, getApiKey, setAuthCookie, clearAuthCookie } from './middleware/auth'
import { apiRateLimit } from './middleware/rateLimit'
import { buildPaymentRequired, parsePaymentReceipt } from './middleware/x402'

const app = express()
app.disable('x-powered-by')

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

app.use(cookieParser())
app.use(express.json())

// Setup Swagger UI documentation at /docs
setupSwagger(app)

// Basic API rate limiting (in-memory)
app.use('/api', apiRateLimit)

const wallets = new WalletManager()
const registry = new Registry()
const payments = new PaymentEngine()
const webhooks = new WebhookManager()
const disputes = new DisputeManager()
const verification = new VerificationManager()
const identityManager = new AgentIdentityManager()

// Create middleware instances with wallet manager
const authMiddleware = requireApiKey(wallets)

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
    const sdk = getInstance({ appId, appSecret })
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
    const sdk = getInstance({ appId, appSecret })
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
      quickStart: `import { AgentsPay } from 'agentspay'\nconst ap = new AgentsPay({ apiKey: '${wallet.apiKey}' })\nconst services = await ap.search({ category: 'ai' })`,
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
      }
    } 
  })
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

    validateServiceEndpoint(String(req.body?.endpoint))

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

  if (req.body?.price !== undefined) {
    const price = Number(req.body.price)
    if (!Number.isInteger(price) || price <= 0 || price > 100000000) return res.status(400).json({ error: 'Invalid price' })
  }
  if (req.body?.endpoint) {
    try {
      validateServiceEndpoint(String(req.body.endpoint))
    } catch (e: any) {
      return res.status(400).json({ error: e.message })
    }
  }

  const service = registry.update(String(req.params.id), req.body)
  res.json({ ok: true, service })
})

// ============ EXECUTE (Pay + Run) ============

app.post('/api/execute/:serviceId', authMiddleware, async (req, res) => {
  const { buyerWalletId, input } = req.body
  const auth = (req as any).authWallet as { id: string }

  // Verify the authenticated wallet matches the buyer
  if (buyerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Authenticated wallet does not match buyerWalletId' })
  }

  const service = registry.getById(req.params.serviceId)

  if (!service) return res.status(404).json({ error: 'Service not found' })
  if (!service.active) return res.status(400).json({ error: 'Service is inactive' })

  try {
    validateServiceEndpoint(service.endpoint)
  } catch (e: any) {
    return res.status(400).json({ error: `Unsafe service endpoint: ${e.message}` })
  }

  const buyer = wallets.getById(buyerWalletId)
  if (!buyer) return res.status(404).json({ error: 'Buyer wallet not found' })

  const currency = service.currency || 'BSV'

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
    const payment = await payments.create(service.id, buyerWalletId, service.agentId, service.price, currency)

    const startTime = Date.now()
    const timeoutMs = (service.timeout || 30) * 1000

    try {
      // Execute with timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      const response = await fetch(service.endpoint, {
        method: service.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))

      if (!response.ok) {
        await payments.refund(payment.id)
        return res.status(502).json({
          error: 'Service execution failed',
          paymentId: payment.id,
          status: 'refunded',
        })
      }

      const output = await response.json()
      const executionTimeMs = Date.now() - startTime

      // Mark payment as completed (starts dispute window)
      const db = getDb()
      db.prepare('UPDATE payments SET completedAt = ? WHERE id = ?').run(new Date().toISOString(), payment.id)

      // Create execution receipt (cryptographic proof)
      const receipt = await verification.createReceipt(
        payment,
        (input as Record<string, unknown>) || ({} as Record<string, unknown>),
        (output as Record<string, unknown>) || ({} as Record<string, unknown>),
        executionTimeMs
      )

      // Release payment immediately (buyer has dispute window to file dispute)
      await payments.release(payment.id)

      // Trigger service.executed webhook (include receipt)
      webhookDelivery.trigger('service.executed', {
        serviceId: service.id,
        paymentId: payment.id,
        executionTimeMs,
        output,
        receipt,
      }).catch(console.error)

      // Check for expired dispute windows
      disputes.checkExpiredWindows()

      res.json({
        ok: true,
        paymentId: payment.id,
        output,
        executionTimeMs,
        cost: {
          amount: service.price,
          amountFormatted: CurrencyManager.format(service.price, currency),
          platformFee: payment.platformFee,
          platformFeeFormatted: CurrencyManager.format(payment.platformFee, currency),
          currency,
        },
        txId: payment.txId,
        disputeWindowMinutes: service.disputeWindow || 30,
        receipt,
      })
    } catch (e: any) {
      // Handle timeout or service failure
      await payments.refund(payment.id)
      
      if (e.name === 'AbortError') {
        res.status(504).json({
          error: `Service timeout after ${service.timeout || 30}s`,
          paymentId: payment.id,
          status: 'refunded',
        })
      } else {
        res.status(502).json({
          error: `Service unreachable: ${e.message}`,
          paymentId: payment.id,
          status: 'refunded',
        })
      }
    }
  } catch (e: any) {
    res.status(500).json({ error: `Payment creation failed: ${e.message}` })
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

app.post('/api/payments/:id/dispute', authMiddleware, (req, res) => {
  const paymentRecord = payments.getById(String(req.params.id))
  if (!paymentRecord) return res.status(404).json({ error: 'Payment not found' })
  
  // Verify user is the buyer
  const auth = (req as any).authWallet as { id: string }
  if (paymentRecord.buyerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Only the buyer can dispute this payment' })
  }
  
  const payment = payments.dispute(String(req.params.id))
  if (!payment) return res.status(400).json({ error: 'Cannot dispute this payment' })
  res.json({ ok: true, payment })
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

app.post('/api/disputes/:id/resolve', authMiddleware, (req, res) => {
  try {
    // Admin check: only platform master key can resolve disputes
    const adminKey = req.headers['x-admin-key']
    const masterKey = process.env.AGENTPAY_MASTER_KEY
    
    if (!masterKey) {
      return res.status(503).json({ error: 'Master key not configured' })
    }
    
    if (adminKey !== masterKey) {
      return res.status(403).json({ error: 'Admin privileges required. Provide valid X-Admin-Key header.' })
    }
    
    const { resolution, splitPercent } = req.body

    if (!resolution || !['refund', 'release', 'split'].includes(resolution)) {
      return res.status(400).json({ error: 'Invalid resolution. Must be: refund, release, or split' })
    }

    const dispute = disputes.resolve(String(req.params.id), { resolution, splitPercent })
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' })

    res.json({ ok: true, dispute })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

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
  db.exec(`CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY, walletId TEXT NOT NULL, amount INTEGER NOT NULL, createdAt TEXT NOT NULL
  )`)
  const { v4: uuidv4 } = await import('uuid')
  db.prepare(`INSERT INTO deposits (id, walletId, amount, createdAt) VALUES (?, ?, ?, datetime('now'))`).run(
    uuidv4(),
    String(req.params.id),
    amount
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
  res.json({ ok: true, service: 'agentpay', version: '0.1.0' })
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
  const toAddress = req.params.address

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
      payment = db.prepare('SELECT * FROM payments WHERE txid = ?').get(receipt.txid)
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
      message: 'Payment verified. Use POST /api/execute/:serviceId with your walletId to execute.',
    })
  } catch (err: any) {
    res.status(500).json({ error: 'Payment verification failed: ' + err.message })
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
