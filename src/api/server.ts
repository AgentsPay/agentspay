import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import net from 'net'
import { WalletManager } from '../wallet/wallet'
import { Registry } from '../registry/registry'
import { PaymentEngine } from '../payment/payment'
import { getDb } from '../registry/db'

const app = express()
app.disable('x-powered-by')
app.use(cors())
app.use(express.json())

// Basic API rate limiting (in-memory)
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
)

const wallets = new WalletManager()
const registry = new Registry()
const payments = new PaymentEngine()

function getApiKey(req: express.Request): string | null {
  const key = req.header('x-api-key') || req.header('authorization')
  if (!key) return null
  const m = key.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : key.trim()
}

function requireApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = getApiKey(req)
  if (!apiKey) return res.status(401).json({ error: 'API key required' })
  const wallet = wallets.getByApiKey(apiKey)
  if (!wallet) return res.status(401).json({ error: 'Invalid API key' })
  ;(req as any).authWallet = wallet
  ;(req as any).apiKey = apiKey
  next()
}

function requireWalletMatch(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = (req as any).authWallet as { id: string } | undefined
  if (!auth) return res.status(500).json({ error: 'Auth context missing' })
  if (req.params.id !== auth.id) return res.status(403).json({ error: 'Forbidden' })
  next()
}

function isPrivateIp(ip: string): boolean {
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

function validateServiceEndpoint(endpoint: string) {
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

app.get('/api/wallets/:id', requireApiKey, requireWalletMatch, async (req, res) => {
  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
  const balance = await wallets.getBalance(req.params.id)
  res.json({ ok: true, wallet: { ...wallet, balance } })
})

// ============ SERVICES (Registry) ============

app.post('/api/services', requireApiKey, (req, res) => {
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

    validateServiceEndpoint(String(req.body?.endpoint))

    const service = registry.register(req.body)
    res.json({ ok: true, service })
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
})

app.get('/api/services', (req, res) => {
  const services = registry.search({
    category: req.query.category as string,
    keyword: req.query.q as string,
    maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  })
  res.json({ ok: true, services })
})

app.get('/api/services/:id', (req, res) => {
  const service = registry.getById(req.params.id)
  if (!service) return res.status(404).json({ error: 'Service not found' })
  res.json({ ok: true, service })
})

app.patch('/api/services/:id', requireApiKey, (req, res) => {
  const auth = (req as any).authWallet as { id: string }
  const existing = registry.getById(req.params.id)
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

  const service = registry.update(req.params.id, req.body)
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
    const payment = await payments.create(service.id, buyerWalletId, service.agentId, service.price)

    const startTime = Date.now()
    try {
      const response = await fetch(service.endpoint, {
        method: service.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })

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

      await payments.release(payment.id)

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
      await payments.refund(payment.id)
      res.status(502).json({
        error: `Service unreachable: ${e.message}`,
        paymentId: payment.id,
        status: 'refunded',
      })
    }
  } catch (e: any) {
    res.status(500).json({ error: `Payment creation failed: ${e.message}` })
  }
})

// ============ PAYMENTS ============

app.get('/api/payments/:id', (req, res) => {
  const payment = payments.getById(req.params.id)
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  res.json({ ok: true, payment })
})

app.post('/api/payments/:id/dispute', (req, res) => {
  const payment = payments.dispute(req.params.id)
  if (!payment) return res.status(400).json({ error: 'Cannot dispute this payment' })
  res.json({ ok: true, payment })
})

// ============ REPUTATION ============

app.get('/api/agents/:id/reputation', (req, res) => {
  const reputation = registry.getReputation(req.params.id)
  res.json({ ok: true, reputation })
})

// ============ WALLET UTXOS ============

app.get('/api/wallets/:id/utxos', async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) return res.status(401).json({ error: 'API key required' })
  if (!wallets.verifyApiKey(req.params.id, apiKey)) return res.status(403).json({ error: 'Forbidden' })

  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  try {
    const utxos = await wallets.getUtxos(req.params.id)
    res.json({ ok: true, utxos })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ============ WALLET TX HISTORY ============

app.get('/api/wallets/:id/transactions', async (req, res) => {
  const apiKey = getApiKey(req)
  if (!apiKey) return res.status(401).json({ error: 'API key required' })
  if (!wallets.verifyApiKey(req.params.id, apiKey)) return res.status(403).json({ error: 'Forbidden' })

  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  try {
    const transactions = await wallets.getTxHistory(req.params.id)
    res.json({ ok: true, transactions })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

// ============ FUND (testnet/demo only) ============

app.post('/api/wallets/:id/fund', requireApiKey, requireWalletMatch, async (req, res) => {
  const { amount } = req.body
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Invalid amount' })

  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY, walletId TEXT NOT NULL, amount INTEGER NOT NULL, createdAt TEXT NOT NULL
  )`)
  const { v4: uuidv4 } = await import('uuid')
  db.prepare(`INSERT INTO deposits (id, walletId, amount, createdAt) VALUES (?, ?, ?, datetime('now'))`).run(
    uuidv4(),
    req.params.id,
    amount
  )

  const balance = await wallets.getBalance(req.params.id)
  res.json({ ok: true, funded: amount, balance, mode: 'internal-ledger' })
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
    console.log(`📋 Registry: GET /api/services`)
    console.log(`💰 Execute:  POST /api/execute/:serviceId`)
    console.log(`👛 Wallets:  POST /api/wallets`)
  })
  return app
}

export { app }

// Auto-start server
startServer()
