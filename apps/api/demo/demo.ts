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

async function demo() {
  console.log('═══════════════════════════════════════')
  console.log('  AgentPay Demo: Agent-to-Agent Payment')
  console.log('═══════════════════════════════════════\n')

  // Start the AgentPay API
  const { startServer } = await import('../src/server')
  startServer()

  // Wait for server
  await new Promise(r => setTimeout(r, 1000))

  // --- Step 1: Create mock provider service ---
  console.log('[Step 1] Starting mock provider service...')
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
  console.log('[Step 2] Creating agent wallets...')
  const providerRes = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json()) as any
  const consumerRes = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json()) as any

  const providerWallet = providerRes.wallet
  const providerApiKey = providerRes.apiKey
  const consumerWallet = consumerRes.wallet
  const consumerApiKey = consumerRes.apiKey

  console.log(`   Provider wallet: ${providerWallet.id.slice(0, 8)}... (${providerWallet.address})`)
  console.log(`   Consumer wallet: ${consumerWallet.id.slice(0, 8)}... (${consumerWallet.address})\n`)

  // --- Step 3: Register service (with auth) ---
  console.log('[Step 3] Provider registers "TextAnalyzer" service...')
  const serviceRes = await fetch(`${API}/api/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': providerApiKey,
    },
    body: JSON.stringify({
      agentId: providerWallet.id,
      name: 'TextAnalyzer',
      description: 'Analyzes text for word count, sentiment, and language detection',
      category: 'nlp',
      price: 1000, // 1000 satoshis
      currency: 'BSV',
      endpoint: 'http://localhost:3101/analyze',
      method: 'POST',
    }),
  }).then(r => r.json()) as any
  console.log(`   Service registered: ${serviceRes.service.name} (${serviceRes.service.price} sats)\n`)

  // --- Step 4: Consumer discovers services ---
  console.log('[Step 4] Consumer searches for NLP services...')
  const searchResults = await fetch(`${API}/api/services?category=nlp`).then(r => r.json()) as any
  console.log(`   Found ${searchResults.services.length} service(s):`)
  for (const s of searchResults.services) {
    console.log(`   -> ${s.name}: ${s.description} (${s.price} sats)`)
  }
  console.log()

  // --- Step 5: Fund consumer wallet (with auth) ---
  console.log('[Step 5] Funding consumer wallet (internal ledger)...')
  const funding = await fetch(`${API}/api/wallets/${consumerWallet.id}/fund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': consumerApiKey,
    },
    body: JSON.stringify({ amount: 100000 }), // 100k sats
  }).then(r => r.json()) as any
  console.log(`   Funded: 100,000 sats | Balance: ${funding.balance} sats`)
  console.log(`   Mode: ${funding.mode} (use real BSV for production)\n`)

  const consumerBalance = funding.balance || 0

  // --- Step 6: Consumer executes (pays + uses) service ---
  if (consumerBalance >= serviceRes.service.price) {
    console.log('[Step 6] Consumer pays and executes TextAnalyzer...')
    try {
      const execution = await fetch(`${API}/api/execute/${serviceRes.service.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': consumerApiKey,
        },
        body: JSON.stringify({
          buyerWalletId: consumerWallet.id,
          input: { text: 'This is a great demo of agent-to-agent payments using BSV micropayments' },
        }),
      }).then(r => r.json()) as any

      if (execution.ok) {
        console.log('   Transaction successful!')
        console.log(`   Payment ID: ${execution.paymentId}`)
        console.log(`   BSV Transaction: ${execution.txId}`)
        console.log(`   Cost: ${execution.cost.amount} ${execution.cost.currency} (fee: ${execution.cost.platformFee})`)
        console.log(`   Result:`, execution.output)

        // --- Step 7: Check receipt ---
        if (execution.receipt) {
          console.log(`\n[Step 7] Execution Receipt:`)
          console.log(`   Receipt hash: ${execution.receipt.receiptHash}`)
          console.log(`   Input hash:   ${execution.receipt.inputHash}`)
          console.log(`   Output hash:  ${execution.receipt.outputHash}`)
        }
      } else {
        console.log(`   Warning: ${execution.error}`)
        if (execution.required) {
          console.log(`   Required: ${execution.required} sats | Available: ${execution.available} sats`)
        }
      }

      // --- Step 8: Check reputation ---
      console.log('\n[Step 8] Provider reputation...')
      const rep = await fetch(`${API}/api/agents/${providerWallet.id}/reputation`).then(r => r.json()) as any
      console.log(`   Total jobs: ${rep.reputation.totalJobs}`)
      console.log(`   Success rate: ${(rep.reputation.successRate * 100).toFixed(0)}%`)
      console.log(`   Total earned: ${rep.reputation.totalEarned} sats`)

      // --- Step 9: Test dispute flow ---
      console.log('\n[Step 9] Testing dispute flow...')
      try {
        const disputeRes = await fetch(`${API}/api/disputes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': consumerApiKey,
          },
          body: JSON.stringify({
            paymentId: execution.paymentId,
            reason: 'Demo dispute: testing the dispute resolution system',
          }),
        }).then(r => r.json()) as any

        if (disputeRes.ok) {
          console.log(`   Dispute opened: ${disputeRes.dispute.id}`)
          console.log(`   Status: ${disputeRes.dispute.status}`)
        } else {
          console.log(`   Dispute note: ${disputeRes.error}`)
        }
      } catch (err: any) {
        console.log(`   Dispute note: ${err.message}`)
      }
    } catch (error: any) {
      console.log(`   Execution failed: ${error.message}`)
    }
  } else {
    console.log('[Step 6] Skipped (insufficient balance)')
  }

  console.log('\n═══════════════════════════════════════')
  console.log('  Demo complete!')
  console.log('  Network: BSV Testnet (demo mode)')
  console.log('  Provider: ' + providerWallet.address)
  console.log('  Consumer: ' + consumerWallet.address)
  console.log('═══════════════════════════════════════')

  process.exit(0)
}

demo().catch(console.error)
