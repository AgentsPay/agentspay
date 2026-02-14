export interface Wallet {
  id: string
  address: string
  privateKey: string
  createdAt: string
  balance?: number
}

export interface Service {
  id: string
  agentId: string
  name: string
  description: string
  category: string
  price: number
  endpoint: string
  method: string
  inputSchema?: any
  outputSchema?: any
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
  status: 'escrowed' | 'released' | 'refunded' | 'disputed'
  txId: string | null
  createdAt: string
  releasedAt?: string
  refundedAt?: string
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
}

export interface ApiResponse<T = any> {
  ok: boolean
  error?: string
  [key: string]: any
}

export interface SearchFilters {
  q?: string
  category?: string
  maxPrice?: number
  limit?: number
  offset?: number
}
