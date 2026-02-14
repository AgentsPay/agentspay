// AgentPay Core Types

export interface AgentWallet {
  id: string
  publicKey: string
  address: string
  createdAt: string
  balance?: number // satoshis
}

export interface Service {
  id: string
  agentId: string        // wallet id del provider
  name: string
  description: string
  category: string
  price: number          // satoshis per call
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
  amount: number         // satoshis
  platformFee: number    // satoshis (2%)
  status: 'pending' | 'escrowed' | 'released' | 'disputed' | 'refunded'
  disputeStatus?: string // 'disputed' | 'no_dispute' | resolution status
  txId?: string          // BSV transaction id
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

export const PLATFORM_FEE_RATE = 0.02 // 2%
export const MIN_PRICE_SATOSHIS = 1
