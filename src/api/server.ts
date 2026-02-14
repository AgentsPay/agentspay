import express from 'express'
import cors from 'cors'
import { WalletManager } from '../wallet/wallet'
import { Registry } from '../registry/registry'
import { PaymentEngine } from '../payment/payment'
import { getDb } from '../registry/db'
import { config } from '../config'
import { requireAuth, requireOwnership, requirePaymentInvolvement, requireServiceOwnership, AuthRequest } from '../middleware/auth'
import { globalLimiter, walletCreationLimiter, serviceRegistrationLimiter, executionLimiter, fundingLimiter } from '../middleware/rateLimit'
import { validateServiceEndpoint, validateServiceRegistration, validateFundingAmount, sanitizeSearchQuery } from '../utils/validation'

const app = express()

// ============ CORS CONFIGURATION ============

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3001',
  'http://localhost:3000',
  'http://localhost:5173',
]

// In demo mode, allow all origins
if (config.demoMode) {
  app.use(cors())
} else {
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, curl, etc.)
      if (!origin) return callback(null, true)
      
      if (allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24 hours
  }))
}

app.use(express.json())

// Apply global rate limiting
app.use(globalLimiter)

const wallets = new WalletManager()
const registry = new Registry()
const payments = new PaymentEngine()

// ============ HEALTH CHECK (PUBLIC) ============

app.get('/api/health', (_req, res) => {
  res.json({ 
    ok: true, 
    service: 'agentspay', 
    version: '0.1.0',
    network: config.network,
    demoMode: config.demoMode,
  })
})

// ============ WALLETS (PUBLIC: create/import) ============

app.post('/api/wallets', walletCreationLimiter, (req, res) => {
  try {
    const wallet = wallets.create()
    res.json({ 
      ok: true, 
      wallet,
      warning: 'Save privateKey and apiKey securely - they cannot be recovered!',
    })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/wallets/import', walletCreationLimiter, (req, res) => {
  const { wif } = req.body
  if (!wif) return res.status(400).json({ error: 'WIF private key required' })
  try {
    const wallet = wallets.importFromWif(wif)
    res.json({ 
      ok: true, 
      wallet,
      warning: 'Save apiKey securely - it cannot be recovered!',
    })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ============ WALLETS (PROTECTED: access requires authentication + ownership) ============

app.get('/api/wallets/:id', requireAuth, requireOwnership('id'), async (req: AuthRequest, res) => {
  const walletId = req.params.id as string
  const wallet = wallets.getById(walletId)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
  
  const balance = await wallets.getBalance(walletId)
  
  // ⚠️ SECURITY: Never return privateKey in API response
  res.json({ ok: true, wallet: { ...wallet, balance } })
})

app.get('/api/wallets/:id/utxos', requireAuth, requireOwnership('id'), async (req: AuthRequest, res) => {
  const walletId = req.params.id as string
  const wallet = wallets.getById(walletId)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  try {
    const utxos = await wallets.getUtxos(walletId)
    res.json({ ok: true, utxos })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/api/wallets/:id/transactions', requireAuth, requireOwnership('id'), async (req: AuthRequest, res) => {
  const walletId = req.params.id as string
  const wallet = wallets.getById(walletId)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  try {
    const transactions = await wallets.getTxHistory(walletId)
    res.json({ ok: true, transactions })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// Fund wallet (testnet/demo only - requires authentication + ownership)
app.post('/api/wallets/:id/fund', fundingLimiter, requireAuth, requireOwnership('id'), async (req: AuthRequest, res) => {
  const walletId = req.params.id as string
  const { amount } = req.body
  
  // Validate input
  const validation = validateFundingAmount(amount)
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error })
  }

  const wallet = wallets.getById(walletId)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  // Credit balance via internal deposits table (for demo/testnet)
  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY, walletId TEXT NOT NULL, amount INTEGER NOT NULL, createdAt TEXT NOT NULL
  )`)
  const { v4: uuidv4 } = await import('uuid')
  db.prepare(`INSERT INTO deposits (id, walletId, amount, createdAt) VALUES (?, ?, ?, datetime('now'))`)
    .run(uuidv4(), walletId, amount)

  const balance = await wallets.getBalance(walletId)
  res.json({ ok: true, funded: amount, balance, mode: 'internal-ledger' })
})

// ============ SERVICES - Registry (PUBLIC: list/search, PROTECTED: register/modify) ============

// Public: List/search services
app.get('/api/services', (req, res) => {
  const q = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q
  const keyword = (q && typeof q === 'string') ? sanitizeSearchQuery(q) : undefined
  
  const category = Array.isArray(req.query.category) ? req.query.category[0] : req.query.category
  const maxPriceStr = Array.isArray(req.query.maxPrice) ? req.query.maxPrice[0] : req.query.maxPrice
  const limitStr = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit
  const offsetStr = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset
  
  const services = registry.search({
    category: category as string,
    keyword,
    maxPrice: maxPriceStr ? Number(maxPriceStr) : undefined,
    limit: limitStr ? Math.min(Number(limitStr), 100) : 20, // Max 100
    offset: offsetStr ? Number(offsetStr) : 0,
  })
  
  res.json({ ok: true, services, count: services.length })
})

// Public: Get service details
app.get('/api/services/:id', (req, res) => {
  const serviceId = req.params.id as string
  const service = registry.getById(serviceId)
  if (!service) return res.status(404).json({ error: 'Service not found' })
  res.json({ ok: true, service })
})

// Protected: Register service (requires authentication)
app.post('/api/services', serviceRegistrationLimiter, requireAuth, async (req: AuthRequest, res) => {
  try {
    // Validate input
    const validation = validateServiceRegistration(req.body)
    if (!validation.valid) {
      return res.status(400).json({ error: 'Validation failed', errors: validation.errors })
    }
    
    // Ensure agentId matches authenticated wallet
    if (req.body.agentId !== req.walletId) {
      return res.status(403).json({ error: 'agentId must match your authenticated wallet' })
    }
    
    // SSRF protection: validate endpoint URL
    const endpointValidation = await validateServiceEndpoint(req.body.endpoint)
    if (!endpointValidation.valid) {
      return res.status(400).json({ error: `Invalid endpoint: ${endpointValidation.error}` })
    }
    
    const service = registry.register(req.body)
    res.json({ ok: true, service })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// Protected: Update service (requires authentication + ownership)
app.patch('/api/services/:id', requireAuth, requireServiceOwnership, async (req: AuthRequest, res) => {
  try {
    const serviceId = req.params.id as string
    // If endpoint is being updated, validate it
    if (req.body.endpoint) {
      const endpointValidation = await validateServiceEndpoint(req.body.endpoint)
      if (!endpointValidation.valid) {
        return res.status(400).json({ error: `Invalid endpoint: ${endpointValidation.error}` })
      }
    }
    
    const service = registry.update(serviceId, req.body)
    if (!service) return res.status(404).json({ error: 'Service not found' })
    res.json({ ok: true, service })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

// ============ EXECUTE SERVICE (PROTECTED) ============

app.post('/api/execute/:serviceId', executionLimiter, requireAuth, async (req: AuthRequest, res) => {
  const serviceId = req.params.serviceId as string
  const { buyerWalletId, input } = req.body
  const service = registry.getById(serviceId)

  if (!service) return res.status(404).json({ error: 'Service not found' })
  if (!service.active) return res.status(400).json({ error: 'Service is inactive' })

  // Authorization: ensure buyerWalletId matches authenticated wallet
  if (buyerWalletId !== req.walletId) {
    return res.status(403).json({ error: 'Cannot execute on behalf of another wallet' })
  }

  const buyer = wallets.getById(buyerWalletId)
  if (!buyer) return res.status(404).json({ error: 'Buyer wallet not found' })

  // Check balance
  const balance = await wallets.getBalance(buyerWalletId)
  if (balance < service.price) {
    return res.status(402).json({
      error: 'Insufficient funds',
      required: service.price,
      available: balance,
      address: buyer.address,
    })
  }

  try {
    // Create escrow payment (real BSV transaction or internal ledger)
    const payment = await payments.create(
      service.id, buyerWalletId, service.agentId, service.price
    )

    // Execute the service
    const startTime = Date.now()
    try {
      const response = await fetch(service.endpoint, {
        method: service.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      })

      if (!response.ok) {
        // Service failed → refund (internal method)
        await payments.refundInternal(payment.id)
        return res.status(502).json({
          error: 'Service execution failed',
          paymentId: payment.id,
          status: 'refunded',
        })
      }

      const output = await response.json()
      const executionTimeMs = Date.now() - startTime

      // Success → release payment (internal method)
      await payments.releaseInternal(payment.id)

      res.json({
        ok: true,
        paymentId: payment.id,
        output,
        executionTimeMs,
        cost: {
          amount: service.price,
          platformFee: payment.platformFee,
          currency: 'satoshis',
        },
        txId: payment.txId,
      })
    } catch (e: any) {
      // Network error or timeout → refund (internal method)
      await payments.refundInternal(payment.id)
      res.status(502).json({
        error: `Service unreachable: ${e.message}`,
        paymentId: payment.id,
        status: 'refunded',
      })
    }
  } catch (e: any) {
    res.status(500).json({
      error: `Payment creation failed: ${e.message}`,
    })
  }
})

// ============ PAYMENTS (PROTECTED) ============

// Get payment (requires authentication + involvement as buyer or seller)
app.get('/api/payments/:id', requireAuth, requirePaymentInvolvement, (req: AuthRequest, res) => {
  const paymentId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
  const payment = payments.getById(paymentId)
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  res.json({ ok: true, payment })
})

// Dispute payment (requires authentication + involvement)
app.post('/api/payments/:id/dispute', requireAuth, requirePaymentInvolvement, (req: AuthRequest, res) => {
  const paymentId = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0]
  const payment = payments.dispute(paymentId)
  if (!payment) return res.status(400).json({ error: 'Cannot dispute this payment' })
  res.json({ ok: true, payment })
})

// ⚠️ SECURITY: Direct release/refund endpoints REMOVED
// These are now internal-only methods, callable only from execute flow

// ============ REPUTATION (PUBLIC) ============

app.get('/api/agents/:id/reputation', (req, res) => {
  const agentId = req.params.id as string
  const reputation = registry.getReputation(agentId)
  res.json({ ok: true, reputation })
})

// ============ START SERVER ============

const PORT = Number(process.env.PORT) || 3100

export function startServer() {
  app.listen(PORT, () => {
    console.log(`🚀 AgentPay API running on http://localhost:${PORT}`)
    console.log(`🌐 Network: ${config.network}`)
    console.log(`🔒 Demo mode: ${config.demoMode ? 'YES (insecure, for testing only)' : 'NO'}`)
    console.log(`📋 Registry: GET /api/services`)
    console.log(`💰 Execute:  POST /api/execute/:serviceId`)
    console.log(`👛 Wallets:  POST /api/wallets`)
    if (!config.demoMode) {
      console.log(`🔐 Authentication: Required (API key-based)`)
    }
  })
  return app
}

export { app }
