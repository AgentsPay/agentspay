/**
 * AgentPay SDK
 *
 * Usage:
 *
 * // Create wallet + get API key
 * const ap = new AgentPay({ apiUrl: 'https://api.agentspay.com' })
 * const { wallet, apiKey } = await ap.createWallet()
 *
 * // Use API key for authenticated requests
 * ap.setApiKey(apiKey)
 *
 * // As a service provider
 * await ap.registerService({
 *   agentId: wallet.id,
 *   name: 'VulnScanner',
 *   description: 'Scan websites for vulnerabilities',
 *   category: 'security',
 *   price: 5000, // 5000 satoshis
 *   endpoint: 'http://my-agent:8080/scan',
 *   method: 'POST',
 * })
 *
 * // As a consumer
 * const services = await ap.search({ keyword: 'scan' })
 * const result = await ap.execute(services[0].id, wallet.id, { target: 'https://example.com' })
 * console.log(result.output)
 */

export interface AgentPayOptions {
  apiUrl?: string
  apiKey?: string
}

export interface WalletResult {
  wallet: {
    id: string
    publicKey: string
    address: string
    createdAt: string
  }
  apiKey: string
  privateKey: string
}

export class AgentPay {
  private apiUrl: string
  private apiKey: string | null

  constructor(opts: AgentPayOptions = {}) {
    this.apiUrl = opts.apiUrl || 'https://api.agentspay.com'
    this.apiKey = opts.apiKey || null
  }

  /**
   * Set API key for authenticated requests
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  /**
   * Build headers including auth if available
   */
  private getHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra,
    }
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey
    }
    return headers
  }

  /**
   * Internal fetch wrapper with error handling
   */
  private async request<T = any>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      ...options,
      headers: this.getHeaders(options?.headers as Record<string, string>),
    })
    const data = await res.json() as any
    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`)
    }
    return data
  }

  /**
   * Create a new wallet. Returns wallet + apiKey + privateKey.
   * Automatically sets the API key for future requests.
   */
  async createWallet(): Promise<WalletResult> {
    const data = await this.request<WalletResult>('/api/wallets', { method: 'POST' })
    // Auto-set API key for convenience
    if (data.apiKey) {
      this.apiKey = data.apiKey
    }
    return data
  }

  /**
   * Get wallet by ID (requires auth)
   */
  async getWallet(id: string) {
    const data = await this.request<{ ok: boolean; wallet: any }>(`/api/wallets/${id}`)
    return data.wallet
  }

  /**
   * Fund wallet (demo mode only, requires auth)
   */
  async fundWallet(walletId: string, amount: number) {
    return this.request(`/api/wallets/${walletId}/fund`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    })
  }

  /**
   * Fund MNEE (demo mode only, requires auth)
   */
  async fundMnee(walletId: string, amount: number) {
    return this.request(`/api/wallets/${walletId}/fund-mnee`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    })
  }

  /**
   * Register a service (requires auth)
   */
  async registerService(service: {
    agentId: string
    name: string
    description: string
    category: string
    price: number
    currency?: 'BSV' | 'MNEE'
    endpoint: string
    method?: 'POST' | 'GET'
    timeout?: number
    disputeWindow?: number
  }) {
    const data = await this.request<{ ok: boolean; service: any }>('/api/services', {
      method: 'POST',
      body: JSON.stringify({ method: 'POST', currency: 'BSV', ...service }),
    })
    return data.service
  }

  /**
   * Search services (no auth required)
   */
  async search(query: { keyword?: string; category?: string; currency?: string; maxPrice?: number } = {}) {
    const params = new URLSearchParams()
    if (query.keyword) params.set('q', query.keyword)
    if (query.category) params.set('category', query.category)
    if (query.currency) params.set('currency', query.currency)
    if (query.maxPrice) params.set('maxPrice', String(query.maxPrice))

    const data = await this.request<{ ok: boolean; services: any[] }>(`/api/services?${params}`)
    return data.services
  }

  /**
   * Get service by ID (no auth required)
   */
  async getService(serviceId: string) {
    const data = await this.request<{ ok: boolean; service: any }>(`/api/services/${serviceId}`)
    return data.service
  }

  /**
   * Execute a service (pay + run, requires auth)
   */
  async execute(serviceId: string, buyerWalletId: string, input: Record<string, unknown>) {
    return this.request(`/api/execute/${serviceId}`, {
      method: 'POST',
      body: JSON.stringify({ buyerWalletId, input }),
    })
  }

  /**
   * Get payment details (requires auth)
   */
  async getPayment(paymentId: string) {
    const data = await this.request<{ ok: boolean; payment: any }>(`/api/payments/${paymentId}`)
    return data.payment
  }

  /**
   * Get execution receipt (no auth required)
   */
  async getReceipt(paymentId: string) {
    const data = await this.request<{ ok: boolean; receipt: any }>(`/api/receipts/${paymentId}`)
    return data.receipt
  }

  /**
   * Open a dispute (requires auth)
   */
  async openDispute(paymentId: string, reason: string, evidence?: string) {
    return this.request('/api/disputes', {
      method: 'POST',
      body: JSON.stringify({ paymentId, reason, evidence }),
    })
  }

  /**
   * Get agent reputation (no auth required)
   */
  async getReputation(agentId: string) {
    const data = await this.request<{ ok: boolean; reputation: any }>(`/api/agents/${agentId}/reputation`)
    return data.reputation
  }

  /**
   * Health check
   */
  async health() {
    return this.request('/api/health')
  }
}

export default AgentPay
