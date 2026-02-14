import express from 'express'
import cors from 'cors'
import { WalletManager } from '../wallet/wallet'
import { Registry } from '../registry/registry'
import { PaymentEngine } from '../payment/payment'
import { getDb } from '../registry/db'

const app = express()
app.use(cors())
app.use(express.json())

const wallets = new WalletManager()
const registry = new Registry()
const payments = new PaymentEngine()

// ============ WALLETS ============

app.post('/api/wallets', (_req, res) => {
  const wallet = wallets.create()
  res.json({ ok: true, wallet })
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

app.get('/api/wallets/:id', async (req, res) => {
  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
  const balance = await wallets.getBalance(req.params.id)
  res.json({ ok: true, wallet: { ...wallet, balance } })
})

// ============ SERVICES (Registry) ============

app.post('/api/services', (req, res) => {
  try {
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

app.patch('/api/services/:id', (req, res) => {
  const service = registry.update(req.params.id, req.body)
  if (!service) return res.status(404).json({ error: 'Service not found' })
  res.json({ ok: true, service })
})

// ============ EXECUTE (Pay + Run) ============

app.post('/api/execute/:serviceId', async (req, res) => {
  const { buyerWalletId, input } = req.body
  const service = registry.getById(req.params.serviceId)

  if (!service) return res.status(404).json({ error: 'Service not found' })
  if (!service.active) return res.status(400).json({ error: 'Service is inactive' })

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

app.post('/api/wallets/:id/fund', async (req, res) => {
  const { amount } = req.body
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' })

  const wallet = wallets.getById(req.params.id)
  if (!wallet) return res.status(404).json({ error: 'Wallet not found' })

  const db = getDb()
  db.exec(`CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY, walletId TEXT NOT NULL, amount INTEGER NOT NULL, createdAt TEXT NOT NULL
  )`)
  const { v4: uuidv4 } = await import('uuid')
  db.prepare(`INSERT INTO deposits (id, walletId, amount, createdAt) VALUES (?, ?, ?, datetime('now'))`)
    .run(uuidv4(), req.params.id, amount)

  const balance = await wallets.getBalance(req.params.id)
  res.json({ ok: true, funded: amount, balance, mode: 'internal-ledger' })
})

// ============ HEALTH ============

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agentpay', version: '0.1.0' })
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

// Uncomment to auto-start:
// startServer()
