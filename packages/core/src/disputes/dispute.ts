import { v4 as uuid } from 'uuid'
import { getDb } from '../registry/db'
import { webhookDelivery } from '../webhooks/delivery'

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

export interface DisputeResolution {
  resolution: 'refund' | 'release' | 'split'
  splitPercent?: number // 0-100, required if resolution='split'
}

export class DisputeManager {
  private normalizeDisputeWindowMinutes(value?: number): number {
    if (!value) return 30
    // Back-compat for legacy ms values
    if (value >= 1000) return Math.round(value / 60000)
    return value
  }

  /**
   * Open a new dispute
   * Can only be opened by buyer within the dispute window
   */
  create(paymentId: string, buyerWalletId: string, reason: string, evidence?: string): Dispute | null {
    const db = getDb()

    // Validate payment exists and is in escrowed state
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as any
    if (!payment) throw new Error('Payment not found')
    if (payment.status !== 'escrowed') throw new Error('Can only dispute escrowed payments')
    if (payment.buyerWalletId !== buyerWalletId) throw new Error('Only buyer can open dispute')

    // Check if dispute already exists
    const existing = db.prepare('SELECT id FROM disputes WHERE paymentId = ?').get(paymentId) as any
    if (existing) throw new Error('Dispute already exists for this payment')

    // Get service to check dispute window
    const service = db.prepare('SELECT disputeWindow FROM services WHERE id = ?').get(payment.serviceId) as any
    if (!service) throw new Error('Service not found')

    const disputeWindowMinutes = this.normalizeDisputeWindowMinutes(service.disputeWindow)
    const disputeDeadline = new Date(new Date(payment.completedAt || payment.createdAt).getTime() + disputeWindowMinutes * 60000)
    
    if (new Date() > disputeDeadline) {
      throw new Error(`Dispute window expired. Must file within ${disputeWindowMinutes} minutes of execution`)
    }

    const id = uuid()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO disputes (id, paymentId, buyerWalletId, providerWalletId, reason, evidence, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(id, paymentId, buyerWalletId, payment.sellerWalletId, reason, evidence || null, now)

    // Update payment status to disputed
    db.prepare('UPDATE payments SET disputeStatus = ? WHERE id = ?').run('disputed', paymentId)

    const dispute = this.getById(id)
    if (dispute) {
      webhookDelivery.trigger('dispute.opened', dispute).catch(console.error)
    }

    return dispute
  }

  /**
   * Resolve a dispute (admin/platform only)
   */
  resolve(disputeId: string, resolution: DisputeResolution): Dispute | null {
    const db = getDb()

    const dispute = this.getById(disputeId)
    if (!dispute) throw new Error('Dispute not found')
    if (dispute.status !== 'open' && dispute.status !== 'under_review') {
      throw new Error('Dispute already resolved')
    }

    if (resolution.resolution === 'split') {
      if (resolution.splitPercent === undefined || resolution.splitPercent < 0 || resolution.splitPercent > 100) {
        throw new Error('splitPercent required for split resolution (0-100)')
      }
    }

    const now = new Date().toISOString()
    let status: Dispute['status']

    switch (resolution.resolution) {
      case 'refund':
        status = 'resolved_refund'
        break
      case 'release':
        status = 'resolved_release'
        break
      case 'split':
        status = 'resolved_split'
        break
    }

    db.prepare(`
      UPDATE disputes 
      SET status = ?, resolution = ?, splitPercent = ?, resolvedAt = ?
      WHERE id = ?
    `).run(status, resolution.resolution, resolution.splitPercent || null, now, disputeId)

    // Update payment status based on resolution
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(dispute.paymentId) as any
    if (payment) {
      db.prepare('UPDATE payments SET disputeStatus = ? WHERE id = ?').run(status, dispute.paymentId)
    }

    const resolvedDispute = this.getById(disputeId)
    if (resolvedDispute) {
      webhookDelivery.trigger('dispute.resolved', resolvedDispute).catch(console.error)
    }

    return resolvedDispute
  }

  /**
   * Get dispute by ID
   */
  getById(id: string): Dispute | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as any
    return row || null
  }

  /**
   * Get dispute by payment ID
   */
  getByPaymentId(paymentId: string): Dispute | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM disputes WHERE paymentId = ?').get(paymentId) as any
    return row || null
  }

  /**
   * List disputes filtered by wallet
   */
  listByWallet(walletId: string, status?: Dispute['status']): Dispute[] {
    const db = getDb()
    
    let query = 'SELECT * FROM disputes WHERE (buyerWalletId = ? OR providerWalletId = ?)'
    const params: any[] = [walletId, walletId]

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    query += ' ORDER BY createdAt DESC'

    return db.prepare(query).all(...params) as Dispute[]
  }

  /**
   * List all disputes (admin only)
   */
  listAll(status?: Dispute['status']): Dispute[] {
    const db = getDb()
    
    if (status) {
      return db.prepare('SELECT * FROM disputes WHERE status = ? ORDER BY createdAt DESC').all(status) as Dispute[]
    }

    return db.prepare('SELECT * FROM disputes ORDER BY createdAt DESC').all() as Dispute[]
  }

  /**
   * Check and auto-resolve expired dispute windows
   * Should be called periodically or on payment completion
   */
  checkExpiredWindows(): void {
    const db = getDb()

    // Find all escrowed payments without disputes that have passed their dispute window
    const expiredPayments = db.prepare(`
      SELECT p.id, p.completedAt, p.createdAt, s.disputeWindow
      FROM payments p
      JOIN services s ON p.serviceId = s.id
      WHERE p.status = 'escrowed' 
        AND p.disputeStatus IS NULL
        AND NOT EXISTS (SELECT 1 FROM disputes WHERE paymentId = p.id)
    `).all() as any[]

    const now = new Date()

    for (const payment of expiredPayments) {
      const disputeWindowMinutes = this.normalizeDisputeWindowMinutes(payment.disputeWindow)
      const disputeDeadline = new Date(
        new Date(payment.completedAt || payment.createdAt).getTime() + disputeWindowMinutes * 60000
      )

      if (now > disputeDeadline) {
        // Auto-release payment to provider (dispute window expired)
        db.prepare('UPDATE payments SET disputeStatus = ? WHERE id = ?').run('no_dispute', payment.id)
        console.log(`[Disputes] Auto-release payment ${payment.id} - dispute window expired`)
      }
    }
  }
}
