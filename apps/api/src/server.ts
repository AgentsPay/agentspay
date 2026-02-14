import express from 'express'
import cors from 'cors'
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
  validateServiceEndpoint
} from '@agentspay/core'
import { setupSwagger } from './docs/swagger'
import { requireApiKey, requireWalletMatch, getApiKey } from './middleware/auth'
import { apiRateLimit } from './middleware/rateLimit'

const app = express()
app.disable('x-powered-by')
app.use(cors())
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

// Create middleware instances with wallet manager
const authMiddleware = requireApiKey(wallets)

// ============ WALLETS ============

// Create wallet + API key for demo/internal usage
app.post('/api/wallets/connect/internal', (_req, res) => {
  const wallet = wallets.create()
  res.json({
    ok: true,
    wallet: { id: wallet.id, publicKey: wallet.publicKey, address: wallet.address, createdAt: wallet.createdAt },
    apiKey: wallet.apiKey,
    privateKey: wallet.privateKey,
  })
})

app.post('/api/wallets', (_req, res) => {
  const wallet = wallets.create()
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
  const services = registry.search({
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    keyword: typeof req.query.q === 'string' ? req.query.q : undefined,
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

app.post('/api/execute/:serviceId', async (req, res) => {
  const { buyerWalletId, input } = req.body
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

app.get('/api/payments/:id', (req, res) => {
  const payment = payments.getById(String(req.params.id))
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  res.json({ ok: true, payment })
})

app.post('/api/payments/:id/dispute', (req, res) => {
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
    // TODO: Add admin check here (for now, any authenticated user can resolve)
    // In production, this should be restricted to platform admins
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
  res.json({ ok: true, funded: amount, balance, mode: 'internal-ledger' })
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
