import { v4 as uuid } from 'uuid'
import { getDb } from '../registry/db'
import { PLATFORM_FEE_RATE } from '../types'
import type { Payment } from '../types'

/**
 * Payment Engine
 * 
 * Flow:
 * 1. Buyer requests execution → payment created as 'pending'
 * 2. Funds verified → payment moves to 'escrowed'
 * 3. Service executed successfully → 'released' (funds to seller)
 * 4. Service fails → 'refunded' (funds back to buyer)
 * 5. Dispute → 'disputed' (manual resolution)
 * 
 * MVP: Internal ledger. TODO: Real BSV transactions with escrow script.
 */
export class PaymentEngine {

  // Create a payment (escrow funds)
  create(serviceId: string, buyerWalletId: string, sellerWalletId: string, amount: number): Payment {
    const db = getDb()
    const id = uuid()
    const platformFee = Math.ceil(amount * PLATFORM_FEE_RATE)
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO payments (id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, status, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 'escrowed', ?)
    `).run(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, now)

    return {
      id, serviceId, buyerWalletId, sellerWalletId,
      amount, platformFee, status: 'escrowed', createdAt: now,
    }
  }

  // Release payment (service completed successfully)
  release(paymentId: string): Payment | null {
    const db = getDb()
    const now = new Date().toISOString()

    const result = db.prepare(`
      UPDATE payments SET status = 'released', completedAt = ?
      WHERE id = ? AND status = 'escrowed'
    `).run(now, paymentId)

    if (result.changes === 0) return null

    // TODO: Broadcast BSV transaction (escrow → seller)
    return this.getById(paymentId)
  }

  // Refund payment (service failed)
  refund(paymentId: string): Payment | null {
    const db = getDb()
    const now = new Date().toISOString()

    const result = db.prepare(`
      UPDATE payments SET status = 'refunded', completedAt = ?
      WHERE id = ? AND status = 'escrowed'
    `).run(now, paymentId)

    if (result.changes === 0) return null

    // TODO: Broadcast BSV refund transaction
    return this.getById(paymentId)
  }

  // Dispute payment
  dispute(paymentId: string): Payment | null {
    const db = getDb()

    db.prepare(`
      UPDATE payments SET status = 'disputed'
      WHERE id = ? AND status = 'escrowed'
    `).run(paymentId)

    return this.getById(paymentId)
  }

  // Get payment by ID
  getById(id: string): Payment | null {
    const db = getDb()
    return db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Payment | null
  }

  // Get payments for a wallet
  getByWallet(walletId: string, role: 'buyer' | 'seller' | 'both' = 'both'): Payment[] {
    const db = getDb()
    if (role === 'buyer') {
      return db.prepare('SELECT * FROM payments WHERE buyerWalletId = ? ORDER BY createdAt DESC').all(walletId) as Payment[]
    } else if (role === 'seller') {
      return db.prepare('SELECT * FROM payments WHERE sellerWalletId = ? ORDER BY createdAt DESC').all(walletId) as Payment[]
    }
    return db.prepare('SELECT * FROM payments WHERE buyerWalletId = ? OR sellerWalletId = ? ORDER BY createdAt DESC').all(walletId, walletId) as Payment[]
  }
}
