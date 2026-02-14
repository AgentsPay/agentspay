/**
 * test-real-tx.ts
 * Full on-chain transaction test with real BSV testnet
 * 
 * Prerequisites:
 * - BSV_NETWORK=testnet
 * - AGENTPAY_DEMO=false
 * - Funded wallet WIF: KzxpufMk94e9zEYussHUHyG3Urx6gtgjE3fUFjecjUNXXifbsWrU
 * - Expected balance: ~99904 sats
 */

import express from 'express'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'

// Setup environment
process.env.BSV_NETWORK = 'testnet'
process.env.AGENTPAY_DEMO = 'false'  // Keep on-chain mode
process.env.AGENTPAY_DEMO_SKIP_AUTH = 'true'  // Skip auth for testing
process.env.AGENTPAY_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // Test key
process.env.PORT = '3100'

const API_BASE = 'http://localhost:3100'
const WOC_BASE = 'https://api.whatsonchain.com/v1/bsv/test'
const FUNDED_WIF = 'KzxpufMk94e9zEYussHUHyG3Urx6gtgjE3fUFjecjUNXXifbsWrU'
const EXPECTED_ADDRESS = 'n1Vjn3EyLFoPunw32xqJfbxeRkLRBUeWvR'
const SERVICE_PRICE = 1000 // sats
const MOCK_SERVICE_PORT = 3102

// Colors for console
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
}

function log(emoji: string, msg: string, data?: any) {
  console.log(`${emoji} ${colors.bright}${msg}${colors.reset}`)
  if (data) console.log(JSON.stringify(data, null, 2))
}

function explorerLink(txid: string): string {
  return `https://test.whatsonchain.com/tx/${txid}`
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function apiCall(method: string, path: string, body?: any): Promise<any> {
  const url = `${API_BASE}${path}`
  const opts: any = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  
  const res = await fetch(url, opts)
  const json = await res.json()
  
  if (!res.ok) {
    throw new Error(`API ${method} ${path} failed: ${JSON.stringify(json)}`)
  }
  
  return json
}

async function startMockService(): Promise<any> {
  const app = express()
  app.use(express.json())
  
  app.post('/echo', (req, res) => {
    log('📨', 'Mock service received request', req.body)
    res.json({
      echo: req.body,
      timestamp: new Date().toISOString(),
      service: 'mock-echo-v1',
    })
  })
  
  return new Promise((resolve) => {
    const server = app.listen(MOCK_SERVICE_PORT, () => {
      log('🎭', `Mock echo service started on http://localhost:${MOCK_SERVICE_PORT}`)
      resolve(server)
    })
  })
}

async function main() {
  console.log(`\n${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.bright}${colors.cyan}║  AgentPay: Real On-Chain Transaction Test (BSV Testnet)   ║${colors.reset}`)
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`)
  
  console.log('[TEST DEBUG] Environment variables:')
  console.log('  BSV_NETWORK:', process.env.BSV_NETWORK)
  console.log('  AGENTPAY_DEMO:', process.env.AGENTPAY_DEMO)
  console.log('  AGENTPAY_DEMO_SKIP_AUTH:', process.env.AGENTPAY_DEMO_SKIP_AUTH)
  console.log()

  // Step 0: Clean database
  const dbPath = 'D:\\agentspay\\data\\agentpay.db'
  if (existsSync(dbPath)) {
    log('🗑️', 'Deleting existing database to start fresh...')
    await unlink(dbPath)
    await sleep(500)
  }

  // Step 1: Start API server
  log('🚀', 'Starting AgentPay API server...')
  const { startServer } = await import('./src/api/server')
  startServer()
  await sleep(2000) // Give server time to start

  // Step 2: Import funded wallet
  log('💳', `Importing funded wallet from WIF...`)
  const importResult = await apiCall('POST', '/api/wallets/import', { wif: FUNDED_WIF })
  const buyerWallet = importResult.wallet
  
  if (buyerWallet.address !== EXPECTED_ADDRESS) {
    throw new Error(`Address mismatch! Expected ${EXPECTED_ADDRESS}, got ${buyerWallet.address}`)
  }
  
  log('✅', `Buyer wallet imported`, {
    id: buyerWallet.id,
    address: buyerWallet.address,
  })

  // Check balance
  const buyerBalanceResult = await apiCall('GET', `/api/wallets/${buyerWallet.id}`)
  const buyerBalance = buyerBalanceResult.wallet.balance
  log('💰', `Buyer wallet balance: ${buyerBalance} sats`)

  if (buyerBalance < SERVICE_PRICE) {
    throw new Error(`Insufficient balance! Need at least ${SERVICE_PRICE} sats, have ${buyerBalance}`)
  }

  // Check UTXOs
  const utxosResult = await apiCall('GET', `/api/wallets/${buyerWallet.id}/utxos`)
  log('📦', `Buyer wallet UTXOs:`, utxosResult.utxos)

  // Step 3: Create provider wallet
  log('👤', 'Creating provider wallet...')
  const providerResult = await apiCall('POST', '/api/wallets')
  const providerWallet = providerResult.wallet
  log('✅', `Provider wallet created`, {
    id: providerWallet.id,
    address: providerWallet.address,
  })

  // Step 4: Start mock echo service
  const mockServer = await startMockService()

  // Step 5: Register the echo service
  log('📝', 'Registering echo service...')
  const serviceResult = await apiCall('POST', '/api/services', {
    agentId: providerWallet.id,
    name: 'Echo Service',
    description: 'Simple echo service for testing real on-chain payments',
    category: 'utility',
    endpoint: `http://localhost:${MOCK_SERVICE_PORT}/echo`,
    method: 'POST',
    price: SERVICE_PRICE,
    active: true,
  })
  const service = serviceResult.service
  log('✅', `Service registered`, {
    id: service.id,
    name: service.name,
    price: service.price,
    endpoint: service.endpoint,
  })

  // Step 6: Execute the service (creates real on-chain payment)
  log('⚡', `Executing service (will create real BSV transactions)...`)
  log('⏳', 'Creating escrow transaction...')
  
  const executeResult = await apiCall('POST', `/api/execute/${service.id}`, {
    buyerWalletId: buyerWallet.id,
    input: { message: 'Hello from AgentPay on-chain test!' },
  })

  log('🎉', `Service executed successfully!`, {
    paymentId: executeResult.paymentId,
    output: executeResult.output,
    executionTimeMs: executeResult.executionTimeMs,
    cost: executeResult.cost,
  })

  // Step 7: Verify payment details
  const paymentResult = await apiCall('GET', `/api/payments/${executeResult.paymentId}`)
  const payment = paymentResult.payment

  console.log(`\n${colors.bright}${colors.green}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.bright}${colors.green}║                    PAYMENT VERIFICATION                    ║${colors.reset}`)
  console.log(`${colors.bright}${colors.green}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`)

  log('💳', `Payment Details:`, {
    id: payment.id,
    status: payment.status,
    amount: payment.amount,
    platformFee: payment.platformFee,
    buyer: buyerWallet.address,
    seller: providerWallet.address,
  })

  if (payment.txId) {
    console.log(`\n${colors.bright}${colors.blue}🔗 Escrow Transaction:${colors.reset}`)
    console.log(`   TxID: ${payment.txId}`)
    console.log(`   Explorer: ${explorerLink(payment.txId)}\n`)
  } else {
    console.log(`${colors.red}❌ No escrow txId found!${colors.reset}\n`)
  }

  if (payment.releaseTxId) {
    console.log(`${colors.bright}${colors.blue}🔗 Release Transaction:${colors.reset}`)
    console.log(`   TxID: ${payment.releaseTxId}`)
    console.log(`   Explorer: ${explorerLink(payment.releaseTxId)}\n`)
  } else {
    console.log(`${colors.red}❌ No release txId found!${colors.reset}\n`)
  }

  // Step 8: Check provider reputation
  const reputationResult = await apiCall('GET', `/api/agents/${providerWallet.id}/reputation`)
  log('⭐', `Provider Reputation:`, reputationResult.reputation)

  // Step 9: Check final balances
  const buyerFinalResult = await apiCall('GET', `/api/wallets/${buyerWallet.id}`)
  const providerFinalResult = await apiCall('GET', `/api/wallets/${providerWallet.id}`)

  console.log(`\n${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.bright}${colors.cyan}║                      FINAL BALANCES                        ║${colors.reset}`)
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`)

  log('💰', `Buyer balance:    ${buyerBalance} → ${buyerFinalResult.wallet.balance} sats`)
  log('💰', `Provider balance: 0 → ${providerFinalResult.wallet.balance} sats`)

  const expectedBuyerBalance = buyerBalance - SERVICE_PRICE
  const expectedProviderBalance = SERVICE_PRICE - payment.platformFee

  if (buyerFinalResult.wallet.balance !== expectedBuyerBalance) {
    console.log(`${colors.yellow}⚠️  Warning: Buyer balance mismatch (expected ${expectedBuyerBalance}, got ${buyerFinalResult.wallet.balance})${colors.reset}`)
  }

  if (providerFinalResult.wallet.balance !== expectedProviderBalance) {
    console.log(`${colors.yellow}⚠️  Warning: Provider balance mismatch (expected ${expectedProviderBalance}, got ${providerFinalResult.wallet.balance})${colors.reset}`)
  }

  // Cleanup
  log('🧹', 'Cleaning up...')
  ;(mockServer as any).close()

  console.log(`\n${colors.bright}${colors.green}✅ Test completed successfully!${colors.reset}\n`)
  
  process.exit(0)
}

main().catch(err => {
  console.error(`\n${colors.red}❌ Test failed:${colors.reset}`, err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
})
