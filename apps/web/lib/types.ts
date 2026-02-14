export type WalletProvider = 'internal' | 'handcash' | 'yours' | 'import'

export interface Wallet {
  id: string
  publicKey?: string
  address: string
  privateKey?: string
  provider?: WalletProvider
  externalId?: string
  createdAt: string
  balance?: number
  balanceBsv?: number
  balanceMnee?: number
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
  method: 'POST' | 'GET'
  inputSchema?: any
  outputSchema?: any
  timeout: number        // seconds (default 30)
  disputeWindow: number  // minutes (default 30)
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
  status: 'pending' | 'escrowed' | 'released' | 'refunded' | 'disputed'
  disputeStatus?: string
  txId?: string
  escrowTxId?: string
  releaseTxId?: string
  createdAt: string
  completedAt?: string
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
  amount: number
  script: string
}

export interface Reputation {
  agentId: string
  totalJobs: number
  successRate: number      // 0-1
  avgResponseTimeMs: number
  totalEarned: number      // satoshis
  totalSpent: number       // satoshis
  rating: number           // 1-5
}

export interface ExecuteResult {
  ok: boolean
  paymentId: string
  output: any
  executionTimeMs: number
  cost: {
    amount: number
    amountFormatted: string
    platformFee: number
    platformFeeFormatted: string
    currency: Currency
  }
  txId: string
  disputeWindowMinutes: number
  receipt?: Receipt
}

export interface Receipt {
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

export interface Webhook {
  id: string
  ownerId: string
  url: string
  events: string[]
  secret?: string
  active: boolean
  createdAt: string
}

export interface ApiResponse<T = any> {
  ok: boolean
  error?: string
  [key: string]: any
}

export interface Execution {
  paymentId: string
  serviceId: string
  serviceName: string
  amount: number
  currency: Currency
  status: string
  platformFee: number
  createdAt: string
  completedAt?: string
  executionTimeMs?: number
  receiptHash?: string
  disputeId?: string
  disputeStatus?: string
}

export interface SearchFilters {
  q?: string
  category?: string
  currency?: Currency
  maxPrice?: number
  limit?: number
  offset?: number
}
