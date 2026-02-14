import { v4 as uuid } from 'uuid'
import { getDb } from './db'
import type { Service, ServiceQuery, ReputationScore } from '../types'
import { webhookDelivery } from '../webhooks/delivery'

export class Registry {
  // Register a new service
  register(service: Omit<Service, 'id' | 'active' | 'createdAt' | 'updatedAt'>): Service {
    const db = getDb()
    const id = uuid()
    const now = new Date().toISOString()

    const timeout = service.timeout || 30
    const disputeWindow = service.disputeWindow || 30
    const currency = service.currency || 'BSV'
    const method = service.method || 'POST'

    db.prepare(`
      INSERT INTO services (id, agentId, name, description, category, price, currency, endpoint, method, inputSchema, outputSchema, active, timeout, disputeWindow, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      id, service.agentId, service.name, service.description, service.category,
      service.price, currency, service.endpoint, method,
      service.inputSchema ? JSON.stringify(service.inputSchema) : null,
      service.outputSchema ? JSON.stringify(service.outputSchema) : null,
      timeout, disputeWindow,
      now, now
    )

    const registeredService = { ...service, id, active: true, currency, timeout, disputeWindow, createdAt: now, updatedAt: now }
    
    // Trigger webhook
    webhookDelivery.trigger('service.registered', registeredService).catch(console.error)

    return registeredService
  }

  // Search/discover services
  search(query: ServiceQuery): Service[] {
    const db = getDb()
    const conditions: string[] = ['active = 1']
    const params: any[] = []

    if (query.category) {
      conditions.push('category = ?')
      params.push(query.category)
    }
    if (query.keyword) {
      conditions.push('(name LIKE ? OR description LIKE ?)')
      params.push(`%${query.keyword}%`, `%${query.keyword}%`)
    }
    if (query.maxPrice) {
      conditions.push('price <= ?')
      params.push(query.maxPrice)
    }

    const limit = query.limit || 20
    const offset = query.offset || 0

    const rows = db.prepare(`
      SELECT * FROM services
      WHERE ${conditions.join(' AND ')}
      ORDER BY createdAt DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as any[]

    return rows.map(this.rowToService)
  }

  // Get service by ID
  getById(id: string): Service | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM services WHERE id = ?').get(id) as any
    return row ? this.rowToService(row) : null
  }

  // Update service
  update(id: string, updates: Partial<Pick<Service, 'name' | 'description' | 'price' | 'currency' | 'endpoint' | 'active' | 'timeout' | 'disputeWindow'>>): Service | null {
    const db = getDb()
    const fields: string[] = ['updatedAt = ?']
    const params: any[] = [new Date().toISOString()]

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`)
      params.push(key === 'active' ? (value ? 1 : 0) : value)
    }
    params.push(id)

    db.prepare(`UPDATE services SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    return this.getById(id)
  }

  // Get reputation for an agent
  getReputation(agentId: string): ReputationScore {
    const db = getDb()

    const stats = db.prepare(`
      SELECT
        COUNT(*) as totalJobs,
        SUM(CASE WHEN status = 'released' THEN 1 ELSE 0 END) as successJobs,
        SUM(CASE WHEN sellerWalletId = ? THEN amount ELSE 0 END) as totalEarned,
        SUM(CASE WHEN buyerWalletId = ? THEN amount ELSE 0 END) as totalSpent
      FROM payments
      WHERE (buyerWalletId = ? OR sellerWalletId = ?)
        AND status IN ('released', 'refunded', 'disputed')
    `).get(agentId, agentId, agentId, agentId) as any

    const avgRating = db.prepare(`
      SELECT AVG(score) as avgScore
      FROM ratings WHERE toAgentId = ?
    `).get(agentId) as any

    return {
      agentId,
      totalJobs: stats?.totalJobs || 0,
      successRate: stats?.totalJobs > 0 ? (stats.successJobs / stats.totalJobs) : 0,
      avgResponseTimeMs: 0, // TODO: track execution times
      totalEarned: stats?.totalEarned || 0,
      totalSpent: stats?.totalSpent || 0,
      rating: avgRating?.avgScore || 0,
    }
  }

  private rowToService(row: any): Service {
    return {
      ...row,
      active: !!row.active,
      currency: row.currency || 'BSV',
      inputSchema: row.inputSchema ? JSON.parse(row.inputSchema) : undefined,
      outputSchema: row.outputSchema ? JSON.parse(row.outputSchema) : undefined,
    }
  }
}
