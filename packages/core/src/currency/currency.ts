/**
 * Multi-Currency Manager for AgentsPay
 * 
 * Supports:
 * - BSV (satoshis) - native blockchain currency
 * - MNEE (USD cents) - 1Sat Ordinals BSV-21 stablecoin (1 MNEE = $0.01 USD)
 * 
 * Currency amounts:
 * - BSV: integer satoshis (1 sat = 0.00000001 BSV)
 * - MNEE: integer cents (1 cent = $0.01 USD, 100 cents = 1 MNEE token)
 */

export type Currency = 'BSV' | 'MNEE'

export interface CurrencyConfig {
  code: Currency
  name: string
  symbol: string
  decimals: number
  minAmount: number
  description: string
}

export interface ConversionRate {
  from: Currency
  to: Currency
  rate: number // how many 'to' units per 1 'from' unit
  timestamp: string
  source?: string
}

export class CurrencyManager {
  private static currencies: Record<Currency, CurrencyConfig> = {
    BSV: {
      code: 'BSV',
      name: 'Bitcoin SV',
      symbol: 'BSV',
      decimals: 8,
      minAmount: 1, // 1 satoshi
      description: 'Native BSV satoshis',
    },
    MNEE: {
      code: 'MNEE',
      name: 'MNEE Stablecoin',
      symbol: 'MNEE',
      decimals: 2, // cents
      minAmount: 1, // 1 cent = $0.01
      description: 'USD-pegged stablecoin on 1Sat Ordinals (BSV-21)',
    },
  }

  /**
   * Get currency configuration
   */
  static getConfig(currency: Currency): CurrencyConfig {
    return this.currencies[currency]
  }

  /**
   * Validate currency code
   */
  static isValid(currency: string): currency is Currency {
    return currency === 'BSV' || currency === 'MNEE'
  }

  /**
   * Validate amount for currency
   */
  static validateAmount(amount: number, currency: Currency): boolean {
    if (!Number.isFinite(amount) || amount < 0) return false
    if (!Number.isInteger(amount)) return false
    const config = this.getConfig(currency)
    return amount >= config.minAmount
  }

  /**
   * Format amount for display
   * BSV: satoshis → BSV with 8 decimals
   * MNEE: cents → USD with 2 decimals
   */
  static format(amount: number, currency: Currency): string {
    const config = this.getConfig(currency)
    const divisor = Math.pow(10, config.decimals)
    const value = (amount / divisor).toFixed(config.decimals)
    return `${value} ${config.symbol}`
  }

  /**
   * Parse amount from human-readable format
   * BSV: "0.00001 BSV" → 1000 satoshis
   * MNEE: "1.50 MNEE" → 150 cents
   */
  static parse(input: string, currency: Currency): number | null {
    const config = this.getConfig(currency)
    const cleaned = input.replace(/[^\d.]/g, '')
    const value = parseFloat(cleaned)
    if (!Number.isFinite(value)) return null
    const amount = Math.round(value * Math.pow(10, config.decimals))
    return this.validateAmount(amount, currency) ? amount : null
  }

  /**
   * Calculate platform fee (2%)
   */
  static calculateFee(amount: number, currency: Currency): number {
    const fee = Math.ceil(amount * 0.02) // 2% platform fee
    const config = this.getConfig(currency)
    return Math.max(fee, config.minAmount) // Fee cannot be less than minimum amount
  }

  /**
   * Get BSV/USD conversion rate (for informational purposes)
   * In production, this would fetch from a price oracle
   * For demo: hardcoded ~$50/BSV (as of Feb 2026 estimate)
   */
  static async getConversionRate(from: Currency, to: Currency): Promise<ConversionRate | null> {
    if (from === to) {
      return { from, to, rate: 1, timestamp: new Date().toISOString() }
    }

    // BSV/USD rate: ~$50 per BSV (hardcoded for demo)
    const bsvUsdRate = 50.0
    const satoshisPerBsv = 100_000_000
    const centsPerUsd = 100

    // 1 satoshi = (50 USD / 100,000,000 sats) * 100 cents/USD
    const satoshiToCents = (bsvUsdRate / satoshisPerBsv) * centsPerUsd // ~0.005 cents per sat

    if (from === 'BSV' && to === 'MNEE') {
      return {
        from,
        to,
        rate: satoshiToCents,
        timestamp: new Date().toISOString(),
        source: 'hardcoded',
      }
    }

    if (from === 'MNEE' && to === 'BSV') {
      return {
        from,
        to,
        rate: 1 / satoshiToCents,
        timestamp: new Date().toISOString(),
        source: 'hardcoded',
      }
    }

    return null
  }

  /**
   * Convert amount between currencies
   * For informational purposes only - actual payments don't auto-convert
   */
  static async convert(amount: number, from: Currency, to: Currency): Promise<number | null> {
    const rate = await this.getConversionRate(from, to)
    if (!rate) return null
    return Math.round(amount * rate.rate)
  }
}
