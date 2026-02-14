/**
 * AgentPay SDK
 * 
 * Usage:
 * 
 * // As a service provider
 * const ap = new AgentPay({ apiUrl: 'http://localhost:3100' })
 * const wallet = await ap.createWallet()
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

export class AgentPay {
  private apiUrl: string

  constructor(opts: { apiUrl?: string } = {}) {
    this.apiUrl = opts.apiUrl || 'http://localhost:3100'
  }

  async createWallet() {
    const res = await fetch(`${this.apiUrl}/api/wallets`, { method: 'POST' })
    const data = await res.json()
    return data.wallet
  }

  async getWallet(id: string) {
    const res = await fetch(`${this.apiUrl}/api/wallets/${id}`)
    const data = await res.json()
    return data.wallet
  }

  async registerService(service: {
    agentId: string
    name: string
    description: string
    category: string
    price: number
    endpoint: string
    method?: 'POST' | 'GET'
  }) {
    const res = await fetch(`${this.apiUrl}/api/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'POST', ...service }),
    })
    const data = await res.json()
    return data.service
  }

  async search(query: { keyword?: string; category?: string; maxPrice?: number } = {}) {
    const params = new URLSearchParams()
    if (query.keyword) params.set('q', query.keyword)
    if (query.category) params.set('category', query.category)
    if (query.maxPrice) params.set('maxPrice', String(query.maxPrice))

    const res = await fetch(`${this.apiUrl}/api/services?${params}`)
    const data = await res.json()
    return data.services
  }

  async execute(serviceId: string, buyerWalletId: string, input: Record<string, unknown>) {
    const res = await fetch(`${this.apiUrl}/api/execute/${serviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyerWalletId, input }),
    })
    return res.json()
  }

  async getReputation(agentId: string) {
    const res = await fetch(`${this.apiUrl}/api/agents/${agentId}/reputation`)
    const data = await res.json()
    return data.reputation
  }
}

export default AgentPay
