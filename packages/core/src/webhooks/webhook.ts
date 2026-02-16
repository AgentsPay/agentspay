import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { getDb } from '../registry/db'
import { validateWebhookUrl } from '../utils/validation'

export interface Webhook {
  id: string
  url: string
  events: string[]
  secret: string
  active: boolean
  createdAt: string
}

export interface WebhookDelivery {
  id: string
  webhookId: string
  eventType: string
  payload: any
  signature: string
  idempotencyKey: string
  status: 'pending' | 'success' | 'failed'
  attempts: number
  lastAttemptAt?: string
  nextRetryAt?: string
  responseStatus?: number
  responseBody?: string
  createdAt: string
  completedAt?: string
}

export const WEBHOOK_EVENTS = [
  'payment.created',
  'payment.escrowed',
  'payment.completed',
  'payment.failed',
  'payment.refunded',
  'service.registered',
  'service.executed',
  'dispute.opened',
  'dispute.resolved',
] as const

export type WebhookEvent = typeof WEBHOOK_EVENTS[number]

export class WebhookManager {
  /**
   * Register a new webhook
   */
  register(params: { url: string; events: string[]; ownerId?: string }): Webhook {
    const db = getDb()
    
    // Validate URL
    validateWebhookUrl(params.url)

    // Validate events
    if (!Array.isArray(params.events) || params.events.length === 0) {
      throw new Error('At least one event must be specified')
    }
    
    const invalidEvents = params.events.filter(e => !WEBHOOK_EVENTS.includes(e as any))
    if (invalidEvents.length > 0) {
      throw new Error(`Invalid events: ${invalidEvents.join(', ')}`)
    }

    const id = `wh_${uuid()}`
    const secret = `whsec_${crypto.randomBytes(32).toString('hex')}`
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO webhooks (id, url, events, secret, active, ownerId, createdAt)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, params.url, JSON.stringify(params.events), secret, params.ownerId || null, now)

    return {
      id,
      url: params.url,
      events: params.events,
      secret,
      active: true,
      createdAt: now,
    }
  }

  /**
   * List webhooks (optionally filtered by owner)
   */
  list(ownerId?: string): Omit<Webhook, 'secret'>[] {
    const db = getDb()
    
    let rows: any[]
    if (ownerId) {
      rows = db.prepare('SELECT id, url, events, active, createdAt FROM webhooks WHERE ownerId = ? ORDER BY createdAt DESC').all(ownerId)
    } else {
      rows = db.prepare('SELECT id, url, events, active, createdAt FROM webhooks ORDER BY createdAt DESC').all()
    }

    return rows.map(row => ({
      id: row.id,
      url: row.url,
      events: JSON.parse(row.events),
      active: !!row.active,
      createdAt: row.createdAt,
    }))
  }

  /**
   * Get webhook by ID (with secret, for internal use)
   */
  getById(id: string): Webhook | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any
    if (!row) return null

    return {
      id: row.id,
      url: row.url,
      events: JSON.parse(row.events),
      secret: row.secret,
      active: !!row.active,
      createdAt: row.createdAt,
    }
  }

  /**
   * Update webhook
   */
  update(id: string, updates: { url?: string; events?: string[]; active?: boolean }, ownerId?: string): Omit<Webhook, 'secret'> | null {
    const db = getDb()

    // Verify ownership if ownerId provided
    if (ownerId) {
      const existing = db.prepare('SELECT ownerId FROM webhooks WHERE id = ?').get(id) as any
      if (!existing) return null
      if (existing.ownerId !== ownerId) {
        throw new Error('Forbidden')
      }
    }

    const fields: string[] = []
    const params: any[] = []

    if (updates.url !== undefined) {
      validateWebhookUrl(updates.url)
      fields.push('url = ?')
      params.push(updates.url)
    }

    if (updates.events !== undefined) {
      if (!Array.isArray(updates.events) || updates.events.length === 0) {
        throw new Error('At least one event must be specified')
      }
      const invalidEvents = updates.events.filter(e => !WEBHOOK_EVENTS.includes(e as any))
      if (invalidEvents.length > 0) {
        throw new Error(`Invalid events: ${invalidEvents.join(', ')}`)
      }
      fields.push('events = ?')
      params.push(JSON.stringify(updates.events))
    }

    if (updates.active !== undefined) {
      fields.push('active = ?')
      params.push(updates.active ? 1 : 0)
    }

    if (fields.length === 0) return null

    params.push(id)
    db.prepare(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`).run(...params)

    const updated = this.getById(id)
    if (!updated) return null

    const { secret, ...withoutSecret } = updated
    return withoutSecret
  }

  /**
   * Delete webhook
   */
  delete(id: string, ownerId?: string): boolean {
    const db = getDb()

    // Verify ownership if ownerId provided
    if (ownerId) {
      const existing = db.prepare('SELECT ownerId FROM webhooks WHERE id = ?').get(id) as any
      if (!existing) return false
      if (existing.ownerId !== ownerId) {
        throw new Error('Forbidden')
      }
    }

    const result = db.prepare('DELETE FROM webhooks WHERE id = ?').run(id)
    return result.changes > 0
  }

  /**
   * Get active webhooks for a specific event
   */
  getActiveWebhooksForEvent(eventType: string): Webhook[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM webhooks WHERE active = 1').all() as any[]

    return rows
      .filter(row => {
        const events = JSON.parse(row.events)
        return events.includes(eventType)
      })
      .map(row => ({
        id: row.id,
        url: row.url,
        events: JSON.parse(row.events),
        secret: row.secret,
        active: !!row.active,
        createdAt: row.createdAt,
      }))
  }

  /**
   * Create a delivery record
   */
  createDelivery(webhookId: string, eventType: string, payload: any): WebhookDelivery {
    const db = getDb()
    const id = `whd_${uuid()}`
    const idempotencyKey = `${webhookId}:${eventType}:${crypto.randomBytes(16).toString('hex')}`
    const now = new Date().toISOString()

    const webhook = this.getById(webhookId)
    if (!webhook) throw new Error('Webhook not found')

    const signature = this.generateSignature(payload, webhook.secret)

    db.prepare(`
      INSERT INTO webhook_deliveries (id, webhookId, eventType, payload, signature, idempotencyKey, status, attempts, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)
    `).run(id, webhookId, eventType, JSON.stringify(payload), signature, idempotencyKey, now)

    return {
      id,
      webhookId,
      eventType,
      payload,
      signature,
      idempotencyKey,
      status: 'pending',
      attempts: 0,
      createdAt: now,
    }
  }

  /**
   * Update delivery status
   */
  updateDelivery(id: string, updates: {
    status?: 'pending' | 'success' | 'failed'
    attempts?: number
    lastAttemptAt?: string
    nextRetryAt?: string
    responseStatus?: number
    responseBody?: string
    completedAt?: string
  }): void {
    const db = getDb()
    const fields: string[] = []
    const params: any[] = []

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`)
      params.push(value)
    }

    params.push(id)
    db.prepare(`UPDATE webhook_deliveries SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  }

  /**
   * Get pending deliveries for retry
   */
  getPendingDeliveries(limit = 100): WebhookDelivery[] {
    const db = getDb()
    const now = new Date().toISOString()

    const rows = db.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE status = 'pending'
        AND attempts < 3
        AND (nextRetryAt IS NULL OR nextRetryAt <= ?)
      ORDER BY createdAt ASC
      LIMIT ?
    `).all(now, limit) as any[]

    return rows.map(row => ({
      id: row.id,
      webhookId: row.webhookId,
      eventType: row.eventType,
      payload: JSON.parse(row.payload),
      signature: row.signature,
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attempts: row.attempts,
      lastAttemptAt: row.lastAttemptAt,
      nextRetryAt: row.nextRetryAt,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
      createdAt: row.createdAt,
      completedAt: row.completedAt,
    }))
  }

  /**
   * Generate HMAC-SHA256 signature
   */
  private generateSignature(payload: any, secret: string): string {
    const data = JSON.stringify(payload)
    return crypto.createHmac('sha256', secret).update(data).digest('hex')
  }
}
