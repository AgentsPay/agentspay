import type {
  Wallet,
  Service,
  Payment,
  Transaction,
  UTXO,
  Reputation,
  ExecuteResult,
  ApiResponse,
  SearchFilters,
  Dispute,
  Webhook,
  Receipt,
  Execution
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'

class AgentPayAPI {
  private async fetch<T = any>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',  // send httpOnly cookies
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

  async logout(): Promise<void> {
    await this.fetch('/api/auth/logout', { method: 'POST' })
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

  async connectHandCash(): Promise<{ authUrl: string }> {
    const data = await this.fetch<{ ok: boolean; authUrl: string }>(
      '/api/wallets/connect/handcash',
      { method: 'GET' }
    )
    return { authUrl: data.authUrl }
  }

  async connectYours(publicKey: string): Promise<Wallet> {
    const data = await this.fetch<{ ok: boolean; wallet: Wallet }>(
      '/api/wallets/connect/yours',
      {
        method: 'POST',
        body: JSON.stringify({ publicKey }),
      }
    )
    return data.wallet
  }

  async connectInternal(): Promise<{ wallet: Wallet; apiKey: string; privateKey: string }> {
    const data = await this.fetch<{ ok: boolean; wallet: Wallet; apiKey: string; privateKey: string }>(
      '/api/wallets/connect/internal',
      { method: 'POST' }
    )
    return { wallet: data.wallet, apiKey: data.apiKey, privateKey: data.privateKey }
  }

  async provisionAgent(name: string, opts?: { type?: string; capabilities?: string[] }): Promise<{
    agent: { walletId: string; address: string; apiKey: string; privateKey: string }
    envConfig: string
    quickStart: string
  }> {
    return this.fetch('/api/agents/provision', {
      method: 'POST',
      body: JSON.stringify({ name, ...opts }),
    })
  }

  async importWallet(privateKey: string): Promise<Wallet> {
    const data = await this.fetch<{ ok: boolean; wallet: Wallet; apiKey: string }>(
      '/api/wallets/connect/import',
      {
        method: 'POST',
        body: JSON.stringify({ privateKey }),
      }
    )
    return data.wallet
  }

  async disconnectWallet(id: string): Promise<void> {
    await this.fetch(`/api/wallets/${id}`, { method: 'DELETE' })
  }

  // ============ EXECUTIONS ============

  async getExecutions(
    walletId: string,
    opts?: { limit?: number; offset?: number; status?: string }
  ): Promise<{ executions: Execution[]; total: number; limit: number; offset: number }> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', opts.limit.toString())
    if (opts?.offset) params.set('offset', opts.offset.toString())
    if (opts?.status) params.set('status', opts.status)
    const query = params.toString()
    return this.fetch(`/api/wallets/${walletId}/executions${query ? `?${query}` : ''}`)
  }

  // ============ SERVICES ============

  async getServices(filters: SearchFilters = {}): Promise<Service[]> {
    const params = new URLSearchParams()
    if (filters.q) params.set('q', filters.q)
    if (filters.category) params.set('category', filters.category)
    if (filters.currency) params.set('currency', filters.currency)
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

  async disputePayment(id: string, reason: string, evidence?: string): Promise<Dispute> {
    const data = await this.fetch<{ ok: boolean; dispute: Dispute }>(`/api/payments/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason, evidence }),
    })
    return data.dispute
  }

  async getReceipt(paymentId: string): Promise<Receipt> {
    const data = await this.fetch<{ ok: boolean; receipt: Receipt }>(`/api/receipts/${paymentId}`)
    return data.receipt
  }

  // ============ DISPUTES ============

  async getDisputes(walletId?: string): Promise<Dispute[]> {
    const params = walletId ? `?walletId=${walletId}` : ''
    const data = await this.fetch<{ ok: boolean; disputes: Dispute[] }>(`/api/disputes${params}`)
    return data.disputes
  }

  async getDispute(id: string): Promise<Dispute> {
    const data = await this.fetch<{ ok: boolean; dispute: Dispute }>(`/api/disputes/${id}`)
    return data.dispute
  }

  // ============ WEBHOOKS ============

  async getWebhooks(walletId: string): Promise<Webhook[]> {
    const data = await this.fetch<{ ok: boolean; webhooks: Webhook[] }>(
      `/api/webhooks?walletId=${walletId}`
    )
    return data.webhooks
  }

  async createWebhook(walletId: string, url: string, events: string[]): Promise<Webhook> {
    const data = await this.fetch<{ ok: boolean; webhook: Webhook }>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ walletId, url, events }),
    })
    return data.webhook
  }

  async deleteWebhook(id: string): Promise<void> {
    await this.fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
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
