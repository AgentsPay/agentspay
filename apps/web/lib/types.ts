export type WalletProvider = 'internal' | 'handcash' | 'yours'

export interface Wallet {
  id: string
  address: string
  privateKey?: string
  provider: WalletProvider
  externalId?: string
  createdAt: string
  balance?: number
  balances?: {
    BSV: {
      amount: number
      formatted: string
    }
    MNEE: {
      amount: number
      formatted: string
    }
  }
}

export type Currency = 'BSV' | 'MNEE'

export interface Service {
  id: string
  agentId: string
  name: string
  description: string
  category: string
  price: number
  currency: Currency
  endpoint: string
  method: string
  inputSchema?: any
  outputSchema?: any
  timeoutMs?: number
  disputeWindowMs?: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface Payment {
  id: string
  serviceId: string
  buyerWalletId: string
  sellerWalletId: string
  amount: number
  platformFee: number
  currency: Currency
  status: 'escrowed' | 'released' | 'refunded' | 'disputed'
  txId: string | null
  receiptHash?: string
  blockchainAnchor?: string
  verified: boolean
  createdAt: string
  releasedAt?: string
  refundedAt?: string
  disputeWindowEnds?: string
}

export interface Transaction {
  txid: string
  value: number
  confirmations: number
  time: number
}

export interface UTXO {
  txid: string
  vout: number
  value: number
  scriptPubKey: string
}

export interface Reputation {
  agentId: string
  totalServices: number
  successfulExecutions: number
  failedExecutions: number
  totalRevenue: number
  averageRating: number
  successRate: number
}

export interface ExecuteResult {
  ok: boolean
  paymentId: string
  output: any
  executionTimeMs: number
  cost: {
    amount: number
    platformFee: number
    currency: string
  }
  txId: string
  receiptHash?: string
  verified?: boolean
}

export interface Receipt {
  id: string
  paymentId: string
  serviceId: string
  buyerWalletId: string
  sellerWalletId: string
  amount: number
  currency: Currency
  input: any
  output: any
  executionTimeMs: number
  hash: string
  blockchainAnchor?: string
  verified: boolean
  createdAt: string
}

export interface Dispute {
  id: string
  paymentId: string
  openedBy: string
  reason: string
  evidence?: string
  status: 'open' | 'resolved_refund' | 'resolved_release' | 'resolved_partial'
  resolution?: string
  createdAt: string
  resolvedAt?: string
}

export interface Webhook {
  id: string
  walletId: string
  url: string
  events: string[]
  active: boolean
  createdAt: string
}

export interface ApiResponse<T = any> {
  ok: boolean
  error?: string
  [key: string]: any
}

export interface SearchFilters {
  q?: string
  category?: string
  currency?: Currency
  maxPrice?: number
  limit?: number
  offset?: number
}
