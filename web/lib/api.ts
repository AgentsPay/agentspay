import type {
  Wallet,
  Service,
  Payment,
  Transaction,
  UTXO,
  Reputation,
  ExecuteResult,
  ApiResponse,
  SearchFilters
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'

class AgentPayAPI {
  private async fetch<T = any>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }

    return data
  }

  // ============ WALLETS ============

  async createWallet(): Promise<Wallet> {
    const data = await this.fetch<{ ok: boolean; wallet: Wallet }>('/api/wallets', {
      method: 'POST',
    })
    return data.wallet
  }

  async getWallet(id: string): Promise<Wallet> {
    const data = await this.fetch<{ ok: boolean; wallet: Wallet }>(`/api/wallets/${id}`)
    return data.wallet
  }

  async fundWallet(id: string, amount: number): Promise<{ funded: number; balance: number }> {
    const data = await this.fetch<{ ok: boolean; funded: number; balance: number }>(
      `/api/wallets/${id}/fund`,
      {
        method: 'POST',
        body: JSON.stringify({ amount }),
      }
    )
    return { funded: data.funded, balance: data.balance }
  }

  async getUtxos(id: string): Promise<UTXO[]> {
    const data = await this.fetch<{ ok: boolean; utxos: UTXO[] }>(`/api/wallets/${id}/utxos`)
    return data.utxos
  }

  async getTransactions(id: string): Promise<Transaction[]> {
    const data = await this.fetch<{ ok: boolean; transactions: Transaction[] }>(
      `/api/wallets/${id}/transactions`
    )
    return data.transactions
  }

  // ============ SERVICES ============

  async getServices(filters: SearchFilters = {}): Promise<Service[]> {
    const params = new URLSearchParams()
    if (filters.q) params.set('q', filters.q)
    if (filters.category) params.set('category', filters.category)
    if (filters.maxPrice) params.set('maxPrice', filters.maxPrice.toString())
    if (filters.limit) params.set('limit', filters.limit.toString())
    if (filters.offset) params.set('offset', filters.offset.toString())

    const query = params.toString()
    const data = await this.fetch<{ ok: boolean; services: Service[] }>(
      `/api/services${query ? `?${query}` : ''}`
    )
    return data.services
  }

  async getService(id: string): Promise<Service> {
    const data = await this.fetch<{ ok: boolean; service: Service }>(`/api/services/${id}`)
    return data.service
  }

  async registerService(service: Omit<Service, 'id' | 'createdAt' | 'updatedAt' | 'active'>): Promise<Service> {
    const data = await this.fetch<{ ok: boolean; service: Service }>('/api/services', {
      method: 'POST',
      body: JSON.stringify(service),
    })
    return data.service
  }

  async updateService(id: string, updates: Partial<Service>): Promise<Service> {
    const data = await this.fetch<{ ok: boolean; service: Service }>(`/api/services/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    })
    return data.service
  }

  // ============ EXECUTE ============

  async executeService(
    serviceId: string,
    buyerWalletId: string,
    input: any
  ): Promise<ExecuteResult> {
    const data = await this.fetch<ExecuteResult>(`/api/execute/${serviceId}`, {
      method: 'POST',
      body: JSON.stringify({ buyerWalletId, input }),
    })
    return data
  }

  // ============ PAYMENTS ============

  async getPayment(id: string): Promise<Payment> {
    const data = await this.fetch<{ ok: boolean; payment: Payment }>(`/api/payments/${id}`)
    return data.payment
  }

  async disputePayment(id: string): Promise<Payment> {
    const data = await this.fetch<{ ok: boolean; payment: Payment }>(`/api/payments/${id}/dispute`, {
      method: 'POST',
    })
    return data.payment
  }

  // ============ REPUTATION ============

  async getReputation(agentId: string): Promise<Reputation> {
    const data = await this.fetch<{ ok: boolean; reputation: Reputation }>(
      `/api/agents/${agentId}/reputation`
    )
    return data.reputation
  }

  // ============ HEALTH ============

  async health(): Promise<{ ok: boolean; service: string; version: string }> {
    return this.fetch('/api/health')
  }
}

export const api = new AgentPayAPI()
