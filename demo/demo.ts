/**
 * AgentPay Demo: Two agents transacting
 * 
 * 1. Creates two agent wallets (provider + consumer)
 * 2. Provider registers a "text analysis" service
 * 3. Provider starts a mock service endpoint
 * 4. Consumer discovers and pays for the service
 * 5. Payment settles automatically
 */

import express from 'express'
import { WalletManager } from '../src/wallet/wallet'
import { Registry } from '../src/registry/registry'
import { PaymentEngine } from '../src/payment/payment'
import { startServer } from '../src/api/server'

async function demo() {
  console.log('═══════════════════════════════════════')
  console.log('  🚀 AgentPay Demo: Agent-to-Agent Payment')
  console.log('═══════════════════════════════════════\n')

  // Start the AgentPay API
  startServer()

  // Wait a sec for server
  await new Promise(r => setTimeout(r, 500))

  // --- Step 1: Create mock provider service ---
  console.log('📡 Step 1: Starting mock provider service...')
  const providerApp = express()
  providerApp.use(express.json())
  providerApp.post('/analyze', (req, res) => {
    const text = req.body.text || ''
    res.json({
      wordCount: text.split(/\s+/).length,
      charCount: text.length,
      sentiment: text.includes('good') || text.includes('great') ? 'positive' : 'neutral',
      language: 'en',
    })
  })
  providerApp.listen(3101, () => console.log('   Provider "TextAnalyzer" listening on :3101\n'))
  await new Promise(r => setTimeout(r, 300))

  const API = 'http://localhost:3100'

  // --- Step 2: Create wallets ---
  console.log('👛 Step 2: Creating agent wallets...')
  const providerWallet = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json())
  const consumerWallet = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json())
  console.log(`   Provider wallet: ${providerWallet.wallet.id.slice(0, 8)}... (${providerWallet.wallet.address})`)
  console.log(`   Consumer wallet: ${consumerWallet.wallet.id.slice(0, 8)}... (${consumerWallet.wallet.address})\n`)

  // --- Step 3: Register service ---
  console.log('📋 Step 3: Provider registers "TextAnalyzer" service...')
  const service = await fetch(`${API}/api/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: providerWallet.wallet.id,
      name: 'TextAnalyzer',
      description: 'Analyzes text for word count, sentiment, and language detection',
      category: 'nlp',
      price: 1000, // 1000 satoshis
      endpoint: 'http://localhost:3101/analyze',
      method: 'POST',
    }),
  }).then(r => r.json())
  console.log(`   Service registered: ${service.service.name} (${service.service.price} sats)\n`)

  // --- Step 4: Consumer discovers services ---
  console.log('🔍 Step 4: Consumer searches for NLP services...')
  const searchResults = await fetch(`${API}/api/services?category=nlp`).then(r => r.json())
  console.log(`   Found ${searchResults.services.length} service(s):`)
  for (const s of searchResults.services) {
    console.log(`   → ${s.name}: ${s.description} (${s.price} sats)`)
  }
  console.log()

  // --- Step 5: Fund consumer wallet (testnet faucet) ---
  console.log('🪙 Step 5: Consumer needs to fund wallet via testnet faucet...')
  console.log(`   Consumer address: ${consumerWallet.wallet.address}`)
  console.log(`   Fund at: https://faucet.satoshisvision.network/`)
  console.log(`   (For demo, we'll check if balance > 0 before proceeding)\n`)
  
  // Check balance
  let consumerBalance = 0
  try {
    const balanceCheck = await fetch(`${API}/api/wallets/${consumerWallet.wallet.id}`).then(r => r.json())
    consumerBalance = balanceCheck.wallet.balance || 0
    console.log(`   Current balance: ${consumerBalance} sats`)
  } catch {
    console.log(`   ⚠️  Could not fetch balance (network might be unavailable)`)
  }

  if (consumerBalance === 0) {
    console.log(`\n   ⚠️  Wallet has 0 balance. For a real demo:`)
    console.log(`   1. Send testnet BSV to: ${consumerWallet.wallet.address}`)
    console.log(`   2. Wait for confirmation`)
    console.log(`   3. Re-run this demo`)
    console.log(`\n   Skipping execution step...\n`)
  }

  // --- Step 6: Consumer executes (pays + uses) service ---
  if (consumerBalance >= service.service.price) {
    console.log('💰 Step 6: Consumer pays and executes TextAnalyzer...')
    try {
      const execution = await fetch(`${API}/api/execute/${service.service.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerWalletId: consumerWallet.wallet.id,
          input: { text: 'This is a great demo of agent-to-agent payments using BSV micropayments' },
        }),
      }).then(r => r.json())

      if (execution.ok) {
        console.log('   ✅ Transaction successful!')
        console.log(`   Payment ID: ${execution.paymentId}`)
        console.log(`   BSV Transaction: ${execution.txId}`)
        console.log(`   View on explorer: https://test.whatsonchain.com/tx/${execution.txId}`)
        console.log(`   Cost: ${execution.cost.amount} sats (fee: ${execution.cost.platformFee} sats)`)
        console.log(`   Result:`, execution.output)
      } else {
        console.log(`   ⚠️  ${execution.error}`)
        if (execution.required) {
          console.log(`   Required: ${execution.required} sats | Available: ${execution.available} sats`)
          console.log(`   → Fund wallet at: ${execution.address}`)
        }
      }

      // --- Step 7: Check reputation ---
      console.log('\n📊 Step 7: Provider reputation...')
      const rep = await fetch(`${API}/api/agents/${providerWallet.wallet.id}/reputation`).then(r => r.json())
      console.log(`   Total jobs: ${rep.reputation.totalJobs}`)
      console.log(`   Success rate: ${(rep.reputation.successRate * 100).toFixed(0)}%`)
      console.log(`   Total earned: ${rep.reputation.totalEarned} sats`)
    } catch (error: any) {
      console.log(`   ⚠️  Execution failed: ${error.message}`)
    }
  } else {
    console.log('💰 Step 6: Skipped (insufficient balance)')
  }

  console.log('\n═══════════════════════════════════════')
  console.log('  ✅ Demo complete! AgentPay with REAL BSV')
  console.log('  Network: BSV Testnet')
  console.log('  Provider: ' + providerWallet.wallet.address)
  console.log('  Consumer: ' + consumerWallet.wallet.address)
  console.log('═══════════════════════════════════════')

  process.exit(0)
}

demo().catch(console.error)
