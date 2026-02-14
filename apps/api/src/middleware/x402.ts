/**
 * x402 Protocol Middleware
 * 
 * Implements HTTP 402 Payment Required as defined by x402.org
 * When an agent requests a paid service without payment, returns
 * a structured 402 response with payment instructions.
 * 
 * Flow:
 * 1. Agent GETs /api/x402/services/:id → receives 402 with payment terms
 * 2. Agent sends payment (on-chain or via /api/execute/:id)
 * 3. Agent GETs /api/x402/services/:id with X-Payment-Receipt header → gets service result
 */

import type { Request, Response, NextFunction } from 'express'

export interface X402PaymentRequired {
  'x-402-version': '1.0'
  status: 402
  service: {
    id: string
    name: string
    description: string
    endpoint: string
  }
  payment: {
    network: 'bsv-mainnet' | 'bsv-testnet'
    currency: 'BSV' | 'MNEE'
    amount: number
    amountFormatted: string
    recipient: string  // platform wallet address
    memo: string       // OP_RETURN reference
  }
  accepts: string[]  // payment methods accepted
  expires: string    // ISO timestamp
}

export interface X402PaymentReceipt {
  txid: string
  paymentId: string
  walletId: string
}

/**
 * Parse X-Payment-Receipt header
 */
export function parsePaymentReceipt(req: Request): X402PaymentReceipt | null {
  const header = req.headers['x-payment-receipt'] as string
  if (!header) return null

  try {
    // Accept JSON or base64-encoded JSON
    let parsed: any
    try {
      parsed = JSON.parse(header)
    } catch {
      parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf-8'))
    }

    if (!parsed.paymentId && !parsed.txid) return null
    return {
      txid: parsed.txid || '',
      paymentId: parsed.paymentId || '',
      walletId: parsed.walletId || '',
    }
  } catch {
    return null
  }
}

/**
 * Build x402 payment required response
 */
export function buildPaymentRequired(service: any, platformAddress: string, network: string): X402PaymentRequired {
  const currency = service.currency || 'BSV'
  const amountFormatted = currency === 'BSV'
    ? `${service.price} sats`
    : `$${(service.price / 100).toFixed(2)} MNEE`

  return {
    'x-402-version': '1.0',
    status: 402,
    service: {
      id: service.id,
      name: service.name,
      description: service.description || '',
      endpoint: `/api/x402/services/${service.id}`,
    },
    payment: {
      network: network === 'mainnet' ? 'bsv-mainnet' : 'bsv-testnet',
      currency,
      amount: service.price,
      amountFormatted,
      recipient: platformAddress,
      memo: `agentpay:${service.id}`,
    },
    accepts: [
      'bsv-onchain',        // Direct BSV transaction
      'agentpay-execute',   // Via /api/execute/:id
      'mnee-transfer',      // MNEE stablecoin
    ],
    expires: new Date(Date.now() + 3600_000).toISOString(), // 1 hour
  }
}
