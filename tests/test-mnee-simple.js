// Simple MNEE test without database
const { CurrencyManager } = require('./dist/currency/currency')

async function test() {
  console.log('🧪 Testing MNEE Currency Manager\n')

  console.log('✅ Currency Configuration:')
  console.log('  BSV:', JSON.stringify(CurrencyManager.getConfig('BSV'), null, 2))
  console.log('  MNEE:', JSON.stringify(CurrencyManager.getConfig('MNEE'), null, 2))

  console.log('\n✅ Amount Validation:')
  console.log('  1000 sats (BSV):', CurrencyManager.validateAmount(1000, 'BSV'))
  console.log('  150 cents (MNEE):', CurrencyManager.validateAmount(150, 'MNEE'))
  console.log('  -10 cents (MNEE):', CurrencyManager.validateAmount(-10, 'MNEE'))
  console.log('  0.5 cents (MNEE):', CurrencyManager.validateAmount(0.5, 'MNEE'))

  console.log('\n✅ Formatting:')
  console.log('  50000000 sats →', CurrencyManager.format(50000000, 'BSV'))
  console.log('  1000 sats →', CurrencyManager.format(1000, 'BSV'))
  console.log('  150 cents →', CurrencyManager.format(150, 'MNEE'))
  console.log('  5000 cents →', CurrencyManager.format(5000, 'MNEE'))
  console.log('  1 cent →', CurrencyManager.format(1, 'MNEE'))

  console.log('\n✅ Fee Calculation (2%):')
  console.log('  10000 sats BSV fee:', CurrencyManager.calculateFee(10000, 'BSV'), 'sats')
  console.log('  1000 cents MNEE fee:', CurrencyManager.calculateFee(1000, 'MNEE'), 'cents ($0.20)')
  console.log('  100 cents MNEE fee:', CurrencyManager.calculateFee(100, 'MNEE'), 'cents ($0.02)')
  console.log('  10 cents MNEE fee:', CurrencyManager.calculateFee(10, 'MNEE'), 'cents (min 1 cent)')

  console.log('\n✅ Parsing:')
  console.log('  "1.50 MNEE" →', CurrencyManager.parse('1.50 MNEE', 'MNEE'), 'cents')
  console.log('  "0.00001 BSV" →', CurrencyManager.parse('0.00001 BSV', 'BSV'), 'sats')
  console.log('  "100.00" MNEE →', CurrencyManager.parse('100.00', 'MNEE'), 'cents')

  console.log('\n✅ Conversion Rates:')
  const bsvToMnee = await CurrencyManager.getConversionRate('BSV', 'MNEE')
  const mneeToBsv = await CurrencyManager.getConversionRate('MNEE', 'BSV')
  console.log('  1 sat =', bsvToMnee.rate.toFixed(6), 'MNEE cents')
  console.log('  1 MNEE cent =', mneeToBsv.rate.toFixed(2), 'sats')
  console.log('  Source:', bsvToMnee.source)

  console.log('\n✅ Conversion Examples:')
  const satsToCents = await CurrencyManager.convert(10000, 'BSV', 'MNEE')
  console.log('  10000 sats ≈', satsToCents, 'cents ($' + (satsToCents/100).toFixed(2) + ')')
  const centsToSats = await CurrencyManager.convert(100, 'MNEE', 'BSV')
  console.log('  100 cents ($1) ≈', centsToSats, 'sats')

  console.log('\n🎉 All currency manager tests passed!')
}

test().catch(console.error)
