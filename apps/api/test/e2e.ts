/**
 * AgentsPay End-to-End Test
 *
 * Tests the complete flow:
 * 1. Health check
 * 2. Create wallets (provider + consumer)
 * 3. Fund consumer wallet (BSV + MNEE)
 * 4. Register service
 * 5. Search/discover service
 * 6. Execute service (pay + run)
 * 7. Verify payment + receipt
 * 8. Check reputation
 * 9. File dispute
 * 10. x402 protocol endpoints
 *
 * Run: npx tsx apps/api/test/e2e.ts
 */

// Force demo mode for testing
process.env.AGENTPAY_DEMO = 'true'
process.env.AGENTPAY_MASTER_KEY = 'e2e-test-key-that-is-at-least-32-characters-long'
process.env.BSV_NETWORK = 'testnet'
process.env.PORT = '3199' // Use different port for tests
process.env.ALLOWED_ORIGINS = 'http://localhost:3199'
// Use temp DB for tests (avoid corrupting dev data)
import { tmpdir } from 'os'
import { join } from 'path'
process.env.AGENTPAY_DB = join(tmpdir(), `agentpay-e2e-${Date.now()}.db`)

import express from 'express'

const API = 'http://localhost:3199'
let passed = 0
let failed = 0
const errors: string[] = []

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++
    console.log(`  PASS: ${message}`)
  } else {
    failed++
    errors.push(message)
    console.log(`  FAIL: ${message}`)
  }
}

async function request(path: string, options?: RequestInit & { apiKey?: string }) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (options?.apiKey) {
    headers['x-api-key'] = options.apiKey
  }
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers,
  })
  const data = await res.json() as any
  return { status: res.status, data }
}

async function runTests() {
  console.log('═══════════════════════════════════════════')
  console.log('  AgentsPay E2E Test Suite')
  console.log('═══════════════════════════════════════════\n')

  // Start mock provider service
  const mockApp = express()
  mockApp.use(express.json())
  mockApp.post('/test-service', (req, res) => {
    const text = req.body.text || ''
    res.json({
      wordCount: text.split(/\s+/).filter(Boolean).length,
      charCount: text.length,
      processed: true,
    })
  })
  const mockServer = mockApp.listen(3198)

  // Import server (auto-starts on import via startServer() at bottom of server.ts)
  await import('../src/server')
  await new Promise(r => setTimeout(r, 1500))

  // ========================================
  // TEST 1: Health Check
  // ========================================
  console.log('\n[Test 1] Health Check')
  const health = await request('/api/health')
  assert(health.status === 200, 'Health returns 200')
  assert(health.data.ok === true, 'Health returns ok=true')
  assert(health.data.version === '0.2.0', `Version is 0.2.0 (got: ${health.data.version})`)

  // ========================================
  // TEST 2: Create Wallets
  // ========================================
  console.log('\n[Test 2] Create Wallets')
  const providerRes = await request('/api/wallets', { method: 'POST' })
  assert(providerRes.status === 200, 'Provider wallet created')
  assert(!!providerRes.data.wallet?.id, 'Provider has wallet ID')
  assert(!!providerRes.data.apiKey, 'Provider has API key')
  assert(!!providerRes.data.wallet?.address, 'Provider has address')
  assert(!!providerRes.data.wallet?.publicKey, 'Provider has public key')
  assert(!!providerRes.data.privateKey, 'Provider received private key (one-time)')

  const consumerRes = await request('/api/wallets', { method: 'POST' })
  assert(consumerRes.status === 200, 'Consumer wallet created')
  assert(!!consumerRes.data.apiKey, 'Consumer has API key')

  const provider = {
    ...providerRes.data.wallet,
    apiKey: providerRes.data.apiKey
  }
  const consumer = {
    ...consumerRes.data.wallet,
    apiKey: consumerRes.data.apiKey
  }

  // ========================================
  // TEST 3: Wallet Auth Required
  // ========================================
  console.log('\n[Test 3] Auth Requirements')
  const noAuth = await request(`/api/wallets/${consumer.id}`)
  assert(noAuth.status === 401, 'Wallet GET without auth returns 401')

  const wrongAuth = await request(`/api/wallets/${consumer.id}`, {
    apiKey: 'invalid-key'
  })
  assert(wrongAuth.status === 401, 'Wrong API key returns 401')

  const rightAuth = await request(`/api/wallets/${consumer.id}`, {
    apiKey: consumer.apiKey
  })
  assert(rightAuth.status === 200, 'Correct API key returns 200')
  assert(rightAuth.data.wallet?.id === consumer.id, 'Returns correct wallet')

  // IDOR test: can't access another wallet with your key
  const idor = await request(`/api/wallets/${provider.id}`, {
    apiKey: consumer.apiKey
  })
  assert(idor.status === 403, 'IDOR protection: cannot access other wallet')

  // ========================================
  // TEST 4: Fund Consumer Wallet
  // ========================================
  console.log('\n[Test 4] Fund Wallet')
  const fundBsv = await request(`/api/wallets/${consumer.id}/fund`, {
    method: 'POST',
    apiKey: consumer.apiKey,
    body: JSON.stringify({ amount: 100000 }),
  })
  assert(fundBsv.status === 200, 'BSV funding successful')
  assert(fundBsv.data.balance >= 100000, `BSV balance >= 100000 (got: ${fundBsv.data.balance})`)

  const fundMnee = await request(`/api/wallets/${consumer.id}/fund-mnee`, {
    method: 'POST',
    apiKey: consumer.apiKey,
    body: JSON.stringify({ amount: 5000 }),
  })
  assert(fundMnee.status === 200, 'MNEE funding successful')

  // Verify balances
  const walletInfo = await request(`/api/wallets/${consumer.id}`, {
    apiKey: consumer.apiKey,
  })
  assert(walletInfo.data.wallet?.balances?.BSV?.amount >= 100000, 'BSV balance correct')
  assert(walletInfo.data.wallet?.balances?.MNEE?.amount >= 5000, 'MNEE balance correct')

  // ========================================
  // TEST 5: Register Service
  // ========================================
  console.log('\n[Test 5] Register Service')

  // Test validation
  const badService = await request('/api/services', {
    method: 'POST',
    apiKey: provider.apiKey,
    body: JSON.stringify({ agentId: provider.id, name: '', description: 'test', price: 100, endpoint: 'http://localhost:3198/test-service' }),
  })
  assert(badService.status === 400, 'Rejects empty service name')

  const serviceRes = await request('/api/services', {
    method: 'POST',
    apiKey: provider.apiKey,
    body: JSON.stringify({
      agentId: provider.id,
      name: 'E2E TextAnalyzer',
      description: 'End-to-end test text analysis service',
      category: 'nlp',
      price: 1000,
      currency: 'BSV',
      endpoint: 'http://localhost:3198/test-service',
      method: 'POST',
      timeout: 30,
      disputeWindow: 30,
    }),
  })
  if (serviceRes.status !== 200) {
    console.log(`  DEBUG: Service registration failed: ${JSON.stringify(serviceRes.data)}`)
  }
  assert(serviceRes.status === 200, `Service registered (status: ${serviceRes.status})`)
  assert(serviceRes.data.service?.name === 'E2E TextAnalyzer', 'Service name correct')
  assert(serviceRes.data.service?.currency === 'BSV', 'Service currency correct')
  assert(serviceRes.data.service?.timeout === 30, `Timeout correct (got: ${serviceRes.data.service?.timeout})`)
  assert(serviceRes.data.service?.disputeWindow === 30, `Dispute window correct (got: ${serviceRes.data.service?.disputeWindow})`)

  const serviceId = serviceRes.data.service?.id
  if (!serviceId) {
    console.log('\n  FATAL: Service registration failed, cannot continue tests')
    console.log(`  Response: ${JSON.stringify(serviceRes.data)}`)
    mockServer.close()
    process.exit(1)
  }

  // IDOR: can't register service for another wallet
  const idorService = await request('/api/services', {
    method: 'POST',
    apiKey: consumer.apiKey,
    body: JSON.stringify({
      agentId: provider.id, // trying to use provider's ID
      name: 'IDOR test',
      description: 'Should fail',
      category: 'test',
      price: 100,
      endpoint: 'http://localhost:3198/test-service',
    }),
  })
  assert(idorService.status === 403, 'IDOR: cannot register service for another wallet')

  // ========================================
  // TEST 6: Search Services
  // ========================================
  console.log('\n[Test 6] Search Services')
  const searchAll = await request('/api/services')
  assert(searchAll.status === 200, 'Search all services')
  assert(searchAll.data.services.length >= 1, `Found ${searchAll.data.services.length} services`)

  const searchCategory = await request('/api/services?category=nlp')
  assert(searchCategory.data.services.length >= 1, 'Found NLP services')

  const searchKeyword = await request('/api/services?q=TextAnalyzer')
  assert(searchKeyword.data.services.length >= 1, 'Found by keyword')

  const searchCurrency = await request('/api/services?currency=BSV')
  assert(searchCurrency.data.services.length >= 1, 'Currency filter works')

  const searchNoResults = await request('/api/services?currency=MNEE&category=nlp')
  // Our test service is BSV, so MNEE filter should exclude it
  const mneeNlpCount = searchNoResults.data.services.length
  console.log(`  INFO: MNEE NLP services: ${mneeNlpCount}`)

  // Get by ID
  const getService = await request(`/api/services/${serviceId}`)
  assert(getService.status === 200, 'Get service by ID')
  assert(getService.data.service?.id === serviceId, 'Correct service returned')

  // ========================================
  // TEST 7: Execute Service
  // ========================================
  console.log('\n[Test 7] Execute Service')
  const execution = await request(`/api/execute/${serviceId}`, {
    method: 'POST',
    apiKey: consumer.apiKey,
    body: JSON.stringify({
      buyerWalletId: consumer.id,
      input: { text: 'Hello world this is a test of the agent payment system' },
    }),
  })
  assert(execution.status === 200, 'Execution successful')
  assert(execution.data.ok === true, 'Execution returned ok=true')
  assert(!!execution.data.paymentId, `Got payment ID: ${execution.data.paymentId}`)
  assert(execution.data.output?.wordCount === 11, `Word count correct (got: ${execution.data.output?.wordCount})`)
  assert(execution.data.output?.processed === true, 'Output processed flag')
  assert(execution.data.cost?.currency === 'BSV', 'Cost currency correct')
  assert(execution.data.cost?.amount === 1000, 'Cost amount correct')
  assert(execution.data.cost?.platformFee > 0, 'Platform fee present')
  assert(!!execution.data.txId, 'Transaction ID present')
  assert(!!execution.data.receipt, 'Receipt included in response')
  assert(!!execution.data.receipt?.receiptHash, 'Receipt hash present')

  const paymentId = execution.data.paymentId

  // ========================================
  // TEST 8: Verify Payment
  // ========================================
  console.log('\n[Test 8] Verify Payment')
  const payment = await request(`/api/payments/${paymentId}`, {
    apiKey: consumer.apiKey,
  })
  assert(payment.status === 200, 'Get payment')
  assert(payment.data.payment?.status === 'released', `Payment status: ${payment.data.payment?.status}`)
  assert(payment.data.payment?.currency === 'BSV', 'Payment currency correct')

  // ========================================
  // TEST 9: Verify Receipt
  // ========================================
  console.log('\n[Test 9] Verify Receipt')
  const receipt = await request(`/api/receipts/${paymentId}`)
  assert(receipt.status === 200, 'Get receipt')
  assert(!!receipt.data.receipt?.receiptHash, 'Receipt hash exists')
  assert(!!receipt.data.receipt?.inputHash, 'Input hash exists')
  assert(!!receipt.data.receipt?.outputHash, 'Output hash exists')
  assert(!!receipt.data.receipt?.providerSignature, 'Provider signature exists')
  assert(!!receipt.data.receipt?.platformSignature, 'Platform signature exists')

  const verify = await request(`/api/receipts/${paymentId}/verify`)
  assert(verify.status === 200, 'Verify receipt endpoint')

  // ========================================
  // TEST 10: Check Reputation
  // ========================================
  console.log('\n[Test 10] Check Reputation')
  const rep = await request(`/api/agents/${provider.id}/reputation`)
  assert(rep.status === 200, 'Get reputation')
  assert(rep.data.reputation?.totalJobs >= 1, `Total jobs >= 1 (got: ${rep.data.reputation?.totalJobs})`)
  assert(rep.data.reputation?.totalEarned >= 1000, `Total earned >= 1000 (got: ${rep.data.reputation?.totalEarned})`)

  // ========================================
  // TEST 11: File Dispute
  // ========================================
  console.log('\n[Test 11] File Dispute')
  const dispute = await request('/api/disputes', {
    method: 'POST',
    apiKey: consumer.apiKey,
    body: JSON.stringify({
      paymentId,
      reason: 'E2E test dispute: service returned incorrect results',
    }),
  })
  assert(dispute.status === 200, `Dispute created (status: ${dispute.status})`)
  if (dispute.data.ok) {
    assert(dispute.data.dispute?.status === 'open', `Dispute status: ${dispute.data.dispute?.status}`)
    assert(dispute.data.dispute?.buyerWalletId === consumer.id, 'Dispute buyer correct')
    assert(dispute.data.dispute?.providerWalletId === provider.id, 'Dispute provider correct')

    // Get dispute
    const getDispute = await request(`/api/disputes/${dispute.data.dispute.id}`, {
      apiKey: consumer.apiKey,
    })
    assert(getDispute.status === 200, 'Get dispute by ID')

    // List disputes
    const listDisputes = await request('/api/disputes', {
      apiKey: consumer.apiKey,
    })
    assert(listDisputes.data.disputes?.length >= 1, 'List disputes returns results')
  } else {
    console.log(`  INFO: Dispute could not be opened: ${dispute.data.error}`)
    // This is expected if payment is already fully settled outside dispute window
  }

  // ========================================
  // TEST 12: x402 Protocol
  // ========================================
  console.log('\n[Test 12] x402 Protocol')
  const x402Info = await request('/api/x402/info')
  assert(x402Info.status === 200, 'x402 info endpoint')
  assert(x402Info.data['x-402-version'] === '1.0', 'x402 version correct')
  assert(x402Info.data.currencies?.includes('BSV'), 'x402 lists BSV currency')
  assert(x402Info.data.currencies?.includes('MNEE'), 'x402 lists MNEE currency')

  const x402Catalog = await request('/api/x402/services')
  assert(x402Catalog.status === 200, 'x402 catalog endpoint')
  assert(x402Catalog.data.services?.length >= 1, 'x402 catalog has services')

  const x402Service = await request(`/api/x402/services/${serviceId}`)
  assert(x402Service.status === 402 || x402Service.status === 200, `x402 service returns 402 or 200 (got: ${x402Service.status})`)
  if (x402Service.status === 402) {
    assert(x402Service.data.payment?.amount === 1000, 'x402 payment amount correct')
    assert(x402Service.data.payment?.currency === 'BSV', 'x402 payment currency correct')
  }

  // ========================================
  // TEST 13: Currency Rates
  // ========================================
  console.log('\n[Test 13] Currency Rates')
  const rates = await request('/api/rates')
  assert(rates.status === 200, 'Rates endpoint')
  assert(!!rates.data.rates, 'Rates object exists')
  assert(!!rates.data.currencies?.BSV, 'BSV config exists')
  assert(!!rates.data.currencies?.MNEE, 'MNEE config exists')

  // ========================================
  // TEST 14: Agent Provisioning
  // ========================================
  console.log('\n[Test 14] Agent Provisioning')
  const provision = await request('/api/agents/provision', {
    method: 'POST',
    body: JSON.stringify({
      name: 'E2E Test Agent',
      type: 'agent',
      capabilities: ['nlp', 'testing'],
    }),
  })
  assert(provision.status === 200, 'Agent provisioned')
  assert(!!provision.data.agent?.walletId, 'Agent has wallet ID')
  assert(!!provision.data.agent?.apiKey, 'Agent has API key')
  assert(!!provision.data.envConfig, 'Agent has env config')
  assert(!!provision.data.quickStart, 'Agent has quickstart code')

  // ========================================
  // TEST 15: Error Handling
  // ========================================
  console.log('\n[Test 15] Error Handling')
  const notFound = await request('/api/services/nonexistent-id')
  assert(notFound.status === 404, 'Service not found returns 404')

  const invalidJson = await fetch(`${API}/api/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
    },
    body: '{invalid json',
  })
  assert(invalidJson.status === 400, 'Invalid JSON returns 400')

  const badAmount = await request(`/api/wallets/${consumer.id}/fund`, {
    method: 'POST',
    apiKey: consumer.apiKey,
    body: JSON.stringify({ amount: -100 }),
  })
  assert(badAmount.status === 400, 'Negative amount rejected')

  // ========================================
  // TEST 16: Webhook CRUD
  // ========================================
  console.log('\n[Test 16] Webhooks')
  const createWebhook = await request('/api/webhooks', {
    method: 'POST',
    apiKey: provider.apiKey,
    body: JSON.stringify({
      url: 'https://example.com/webhook',
      events: ['payment.escrowed', 'payment.completed'],
    }),
  })
  assert(createWebhook.status === 200, 'Webhook created')
  assert(!!createWebhook.data.webhook?.id, 'Webhook has ID')
  assert(!!createWebhook.data.webhook?.secret, 'Webhook has secret')

  if (createWebhook.data.webhook?.id) {
    const listWebhooks = await request('/api/webhooks', {
      apiKey: provider.apiKey,
    })
    assert(listWebhooks.data.webhooks?.length >= 1, 'Webhook listed')

    const deleteWebhook = await request(`/api/webhooks/${createWebhook.data.webhook.id}`, {
      method: 'DELETE',
      apiKey: provider.apiKey,
    })
    assert(deleteWebhook.status === 200, 'Webhook deleted')
  }

  // ========================================
  // TEST 17: Logout
  // ========================================
  console.log('\n[Test 17] Auth/Logout')
  const logout = await request('/api/auth/logout', { method: 'POST' })
  assert(logout.status === 200, 'Logout successful')

  // ========================================
  // SUMMARY
  // ========================================
  console.log('\n═══════════════════════════════════════════')
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`)
  console.log('═══════════════════════════════════════════')

  if (errors.length > 0) {
    console.log('\n  FAILURES:')
    for (const err of errors) {
      console.log(`    - ${err}`)
    }
  }

  console.log()

  // Cleanup
  mockServer.close()
  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(err => {
  console.error('E2E Test Fatal Error:', err)
  process.exit(1)
})
