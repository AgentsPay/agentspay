// AgentPay Core Types

export type Currency = 'BSV' | 'MNEE'

export interface AgentWallet {
  id: string
  publicKey: string
  address: string
  createdAt: string
  balance?: number // satoshis (BSV)
  balanceMnee?: number // cents (MNEE)
}

export interface Service {
  id: string
  agentId: string        // wallet id del provider
  name: string
  description: string
  category: string
  price: number          // amount per call (satoshis for BSV, cents for MNEE)
  currency: Currency     // 'BSV' or 'MNEE'
  endpoint: string       // URL donde el agente provider escucha
  method: 'POST' | 'GET'
  inputSchema?: object   // JSON schema del input esperado
  outputSchema?: object  // JSON schema del output
  active: boolean
  timeout: number        // max execution time in seconds (default 30)
  disputeWindow: number  // dispute window in minutes (default 30)
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id: string
  serviceId: string
  buyerWalletId: string
  sellerWalletId: string
  amount: number         // amount (satoshis for BSV, cents for MNEE)
  platformFee: number    // platform fee (satoshis for BSV, cents for MNEE) - 2%
  currency: Currency     // 'BSV' or 'MNEE'
  status: 'pending' | 'escrowed' | 'released' | 'disputed' | 'refunded'
  disputeStatus?: string // 'disputed' | 'no_dispute' | resolution status
  txId?: string          // Transaction id (BSV txid or MNEE token transfer id)
  createdAt: string
  completedAt?: string
}

export interface ExecutionRequest {
  serviceId: string
  buyerWalletId: string
  input: Record<string, unknown>
}

export interface ExecutionResult {
  paymentId: string
  serviceId: string
  output: Record<string, unknown>
  executionTimeMs: number
  status: 'success' | 'error'
}

export interface ReputationScore {
  agentId: string
  totalJobs: number
  successRate: number    // 0-1
  avgResponseTimeMs: number
  totalEarned: number    // satoshis
  totalSpent: number     // satoshis
  rating: number         // 1-5
}

export interface ServiceQuery {
  category?: string
  keyword?: string
  currency?: Currency
  maxPrice?: number
  minRating?: number
  limit?: number
  offset?: number
}

export interface Dispute {
  id: string
  paymentId: string
  buyerWalletId: string
  providerWalletId: string
  reason: string
  evidence?: string
  status: 'open' | 'under_review' | 'resolved_refund' | 'resolved_release' | 'resolved_split' | 'expired'
  resolution?: 'refund' | 'release' | 'split'
  splitPercent?: number
  resolvedAt?: string
  createdAt: string
}

export interface ExecutionReceipt {
  id: string
  paymentId: string
  serviceId: string
  inputHash: string
  outputHash: string
  timestamp: number
  executionTimeMs: number
  providerSignature: string
  platformSignature: string
  receiptHash: string
  blockchainTxId?: string
  blockchainAnchoredAt?: string
}

export const PLATFORM_FEE_RATE = 0.02 // 2%
export const MIN_PRICE_SATOSHIS = 1
