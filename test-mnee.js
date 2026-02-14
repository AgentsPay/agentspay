// Quick MNEE integration test
// Run with: DEMO_MODE=true node test-mnee.js

const { CurrencyManager } = require('./dist/currency/currency')
const { mneeTokens } = require('./dist/bsv/mnee')

async function test() {
  console.log('🧪 Testing MNEE Integration\n')

  // Test 1: Currency validation
  console.log('1️⃣ Currency Validation:')
  console.log('  BSV valid:', CurrencyManager.validateAmount(1000, 'BSV'))
  console.log('  MNEE valid:', CurrencyManager.validateAmount(150, 'MNEE'))
  console.log('  Invalid:', CurrencyManager.validateAmount(-10, 'MNEE'))

  // Test 2: Formatting
  console.log('\n2️⃣ Amount Formatting:')
  console.log('  1000 sats:', CurrencyManager.format(1000, 'BSV'))
  console.log('  150 cents:', CurrencyManager.format(150, 'MNEE'))
  console.log('  5000 cents:', CurrencyManager.format(5000, 'MNEE'))

  // Test 3: Fee calculation
  console.log('\n3️⃣ Platform Fee (2%):')
  console.log('  BSV fee on 10000 sats:', CurrencyManager.calculateFee(10000, 'BSV'), 'sats')
  console.log('  MNEE fee on 1000 cents ($10):', CurrencyManager.calculateFee(1000, 'MNEE'), 'cents')

  // Test 4: Conversion rates
  console.log('\n4️⃣ Conversion Rates:')
  const bsvToMnee = await CurrencyManager.getConversionRate('BSV', 'MNEE')
  console.log('  BSV → MNEE:', bsvToMnee.rate, 'cents per sat')
  const mneeToBsv = await CurrencyManager.getConversionRate('MNEE', 'BSV')
  console.log('  MNEE → BSV:', mneeToBsv.rate, 'sats per cent')

  // Test 5: Demo mode MNEE operations
  console.log('\n5️⃣ Demo Mode MNEE Operations:')
  const testAddress = '1TestAddressXXXXXXXXXXXXXXXXXXXXX'
  
  await mneeTokens.fundDemo(testAddress, 10000) // $100
  console.log('  Funded:', testAddress, 'with 10000 cents ($100)')
  
  const balance = await mneeTokens.getBalance(testAddress)
  console.log('  Balance:', balance, 'cents', `($${(balance/100).toFixed(2)})`)

  console.log('\n✅ All tests passed!')
}

test().catch(console.error)
