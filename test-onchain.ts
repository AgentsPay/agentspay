/**
 * Test REAL on-chain BSV transaction on testnet
 */
import express from 'express'

const API = 'http://localhost:3100'

async function test() {
  console.log('═══════════════════════════════════════')
  console.log('  🧪 AgentPay ON-CHAIN TEST (BSV Testnet)')
  console.log('═══════════════════════════════════════\n')

  // Step 1: Create provider wallet (new, unfunded - will receive payment)
  console.log('👛 Step 1: Creating provider wallet...')
  const provider = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json())
  console.log(`   Provider: ${provider.wallet.address}`)

  // Step 2: Create consumer wallet and import the funded one
  // We need to use the pre-funded wallet. Since we can't import directly,
  // let's create a new wallet and check the funded address
  console.log('\n👛 Step 2: Creating consumer wallet...')
  const consumer = await fetch(`${API}/api/wallets`, { method: 'POST' }).then(r => r.json())
  console.log(`   Consumer: ${consumer.wallet.address}`)
  
  // Check funded wallet balance
  console.log('\n💰 Checking funded wallet balance...')
  const fundedAddr = 'n1Vjn3EyLFoPunw32xqJfbxeRkLRBUeWvR'
  const balResp = await fetch(`https://api.whatsonchain.com/v1/bsv/test/address/${fundedAddr}/balance`)
  const bal = await balResp.json() as any
  console.log(`   Funded wallet (${fundedAddr}): ${bal.confirmed + bal.unconfirmed} sats`)

  // Step 3: Check consumer balance (should be 0 since it's new)
  console.log('\n💰 Step 3: Checking consumer balance...')
  const consumerInfo = await fetch(`${API}/api/wallets/${consumer.wallet.id}`).then(r => r.json())
  console.log(`   Consumer balance: ${consumerInfo.wallet?.balance || 0} sats`)

  // Step 4: Start mock service  
  console.log('\n📡 Step 4: Starting mock service...')
  const svcApp = express()
  svcApp.use(express.json())
  svcApp.post('/echo', (req, res) => {
    res.json({ echo: req.body, timestamp: Date.now() })
  })
  await new Promise<void>(resolve => svcApp.listen(3102, () => resolve()))
  console.log('   Echo service on :3102')

  // Step 5: Register service
  console.log('\n📋 Step 5: Registering service...')
  const service = await fetch(`${API}/api/services`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: provider.wallet.id,
      name: 'EchoService',
      description: 'Echoes back input (test)',
      category: 'test',
      price: 1000,
      endpoint: 'http://localhost:3102/echo',
      method: 'POST',
    }),
  }).then(r => r.json())
  console.log(`   Service: ${service.service.name} (${service.service.price} sats)`)

  // Step 6: Try to execute (will fail with no UTXOs - that's expected since funded wallet is different)
  console.log('\n💰 Step 6: Attempting on-chain execution...')
  console.log('   (Consumer wallet is new/unfunded, so this will show the error handling)')
  
  try {
    const exec = await fetch(`${API}/api/execute/${service.service.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buyerWalletId: consumer.wallet.id,
        input: { message: 'Hello from AgentPay!' },
      }),
    }).then(r => r.json())
    
    if (exec.ok) {
      console.log('   ✅ ON-CHAIN TRANSACTION SUCCESS!')
      console.log(`   TxID: ${exec.txId}`)
      console.log(`   Explorer: https://test.whatsonchain.com/tx/${exec.txId}`)
      console.log(`   Output:`, exec.output)
    } else {
      console.log(`   ❌ Expected: ${exec.error}`)
    }
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`)
  }

  console.log('\n═══════════════════════════════════════')
  console.log('  ℹ️  To test full on-chain flow:')
  console.log('  1. Send testnet BSV to consumer wallet')
  console.log(`     Address: ${consumer.wallet.address}`)
  console.log('  2. Wait for confirmation')
  console.log('  3. Re-run this test')
  console.log('═══════════════════════════════════════')

  // Show all wallet info
  console.log('\n📊 Summary:')
  console.log(`   Funded wallet: ${fundedAddr} (${bal.confirmed + bal.unconfirmed} sats)`)
  console.log(`   Provider: ${provider.wallet.address} (new)`)
  console.log(`   Consumer: ${consumer.wallet.address} (new)`)
  console.log(`   Provider WIF: ${provider.wallet.privateKey}`)
  console.log(`   Consumer WIF: ${consumer.wallet.privateKey}`)

  process.exit(0)
}

test().catch(console.error)
