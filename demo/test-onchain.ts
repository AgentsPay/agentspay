/**
 * On-Chain BSV Transaction Test
 * Uses the funded platform wallet to test real transactions
 */

import express from 'express'

const PLATFORM_WIF = 'KzxpufMk94e9zEYussHUHyG3Urx6gtgjE3fUFjecjUNXXifbsWrU'
const PLATFORM_ADDRESS = 'n1Vjn3EyLFoPunw32xqJfbxeRkLRBUeWvR'
const API = 'http://localhost:3100'

async function testOnChain() {
  console.log('═══════════════════════════════════════')
  console.log('  🧪 AgentPay On-Chain BSV Test')
  console.log('  Network: BSV Testnet')
  console.log('═══════════════════════════════════════\n')

  // Start mock provider service
  console.log('📡 Step 1: Starting mock provider service...')
  const providerApp = express()
  providerApp.use(express.json())
  providerApp.post('/analyze', (req, res) => {
    const text = req.body.text || ''
    res.json({
      wordCount: text.split(/\s+/).length,
      charCount: text.length,
      sentiment: 'positive',
    })
  })
  providerApp.listen(3101, () => console.log('   Mock service on :3101\n'))
  await new Promise(r => setTimeout(r, 500))

  // Create provider wallet
  console.log('👛 Step 2: Creating wallets...')
  const providerRes = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json())
  console.log(`   Provider: ${providerRes.wallet.address}`)

  // Import platform wallet as consumer
  console.log(`   Importing platform wallet: ${PLATFORM_ADDRESS}`)
  const consumerRes = await fetch(`${API}/api/wallets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wif: PLATFORM_WIF }),
  }).then(r => r.json())

  if (!consumerRes.ok) {
    console.log(`   ❌ Failed to import: ${consumerRes.error}`)
    process.exit(1)
  }
  console.log(`   Consumer: ${consumerRes.wallet.address}`)

  // Check balance
  const balanceRes = await fetch(`${API}/api/wallets/${consumerRes.wallet.id}`).then(r => r.json())
  const balance = balanceRes.wallet?.balance || balanceRes.balance || 0
  console.log(`   Balance: ${balance} sats\n`)

  if (balance < 1000) {
    console.log(`   ❌ Insufficient balance for test (need at least 1000 sats, have ${balance})`)
    process.exit(1)
  }

  // Register service
  console.log('📋 Step 3: Registering service...')
  const serviceRes = await fetch(`${API}/api/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: providerRes.wallet.id,
      name: 'TextAnalyzer',
      description: 'Test service for on-chain transactions',
      category: 'nlp',
      price: 1000,
      endpoint: 'http://localhost:3101/analyze',
      method: 'POST',
    }),
  }).then(r => r.json())
  console.log(`   Service: ${serviceRes.service.name} (${serviceRes.service.price} sats)\n`)

  // Execute service with on-chain payment
  console.log('💰 Step 4: Executing service with on-chain BSV payment...')
  try {
    const execRes = await fetch(`${API}/api/execute/${serviceRes.service.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerWalletId: consumerRes.wallet.id,
        input: { text: 'Testing real on-chain BSV micropayments on testnet!' },
      }),
    }).then(r => r.json())

    if (execRes.ok) {
      console.log('   ✅ Transaction successful!')
      console.log(`   Payment ID: ${execRes.paymentId}`)
      console.log(`   TX ID: ${execRes.txId}`)
      console.log(`   Explorer: https://test.whatsonchain.com/tx/${execRes.txId}`)
      console.log(`   Cost: ${execRes.cost.amount} sats (fee: ${execRes.cost.platformFee} sats)`)
      console.log(`   Result: ${JSON.stringify(execRes.output)}`)
      
      // Verify on-chain
      console.log('\n🔍 Step 5: Verifying on WhatsOnChain...')
      await new Promise(r => setTimeout(r, 2000))
      const verify = await fetch(`https://api.whatsonchain.com/v1/bsv/test/tx/${execRes.txId}`).catch(() => null)
      if (verify && verify.ok) {
        const txData = await verify.json()
        console.log(`   ✅ Confirmed: ${txData.txid}`)
        console.log(`   Block: ${txData.blockhash || 'mempool'}`)
      } else {
        console.log(`   ⏳ Broadcast, waiting for confirmation`)
      }

      // Check final balance
      const finalBalance = await fetch(`${API}/api/wallets/${consumerRes.wallet.id}`).then(r => r.json())
      console.log(`\n💰 Final consumer balance: ${finalBalance.balance} sats`)
    } else {
      console.log(`   ❌ ${execRes.error}`)
      if (execRes.required) {
        console.log(`   Required: ${execRes.required} | Available: ${execRes.available}`)
      }
    }
  } catch (error: any) {
    console.log(`   ❌ Execution failed: ${error.message}`)
    console.error(error)
  }

  console.log('\n═══════════════════════════════════════')
  console.log('  ✅ Test complete!')
  console.log('═══════════════════════════════════════')
  process.exit(0)
}

testOnChain().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
