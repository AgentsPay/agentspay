import { v4 as uuid } from 'uuid'
import { getDb } from '../registry/db'
import { PLATFORM_FEE_RATE } from '../types'
import type { Payment } from '../types'
import { WalletManager } from '../wallet/wallet'
import { buildTransaction, privateKeyFromWif, getTxId } from '../bsv/crypto'
import { broadcastTx } from '../bsv/whatsonchain'
import { config } from '../config'

/**
 * Payment Engine with Real BSV Transactions
 * 
 * Flow:
 * 1. Buyer requests execution → payment created as 'pending'
 * 2. Buyer sends funds to platform escrow wallet → 'escrowed'
 * 3. Service executed successfully → platform sends to seller → 'released'
 * 4. Service fails → platform refunds buyer → 'refunded'
 * 5. Dispute → 'disputed' (manual resolution)
 * 
 * MVP: Platform escrow (centralized). Funds go to platform wallet temporarily.
 * Future: Implement hashlock (HTLC) or 2-of-3 multisig for trustless escrow.
 */
export class PaymentEngine {
  private wallets = new WalletManager()

  /**
   * Create a payment (escrow funds on-chain)
   * Buyer must send funds to platform escrow address
   */
  async create(serviceId: string, buyerWalletId: string, sellerWalletId: string, amount: number): Promise<Payment> {
    const db = getDb()
    const id = uuid()
    const platformFee = Math.ceil(amount * PLATFORM_FEE_RATE)
    const now = new Date().toISOString()

    if (config.demoMode) {
      // Demo mode: internal ledger, no on-chain tx
      db.prepare(`
        INSERT INTO payments (id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'escrowed', ?, ?)
      `).run(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, `demo-${id.slice(0,8)}`, now)

      return {
        id, serviceId, buyerWalletId, sellerWalletId,
        amount, platformFee, status: 'escrowed',
        txId: `demo-${id.slice(0,8)}`,
        createdAt: now,
      }
    }

    // On-chain mode
    const buyerWallet = this.wallets.getById(buyerWalletId)
    if (!buyerWallet) throw new Error('Buyer wallet not found')

    const buyerPrivKeyWif = this.wallets.getPrivateKey(buyerWalletId)
    if (!buyerPrivKeyWif) throw new Error('Cannot access buyer private key')

    const buyerPrivKey = privateKeyFromWif(buyerPrivKeyWif)
    const utxos = await this.wallets.getUtxos(buyerWalletId)
    if (utxos.length === 0) throw new Error('No UTXOs available. Please fund your wallet.')

    const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.amount, 0)
    if (totalAvailable < amount) throw new Error(`Insufficient funds. Need ${amount} sats, have ${totalAvailable} sats`)

    const platformAddress = this.getPlatformEscrowAddress()

    try {
      const txHex = await buildTransaction(utxos, [{ address: platformAddress, amount }], buyerWallet.address, buyerPrivKey)
      const txId = await broadcastTx(txHex)

      db.prepare(`
        INSERT INTO payments (id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'escrowed', ?, ?)
      `).run(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, txId, now)

      return { id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, status: 'escrowed', txId, createdAt: now }
    } catch (error: any) {
      throw new Error(`Failed to create escrow transaction: ${error.message}`)
    }
  }

  /**
   * Release payment (service completed successfully)
   * Platform sends escrowed funds to seller
   * 
   * ⚠️ SECURITY: Internal use only. Not exposed via API.
   * Only callable from execute flow.
   */
  async release(paymentId: string): Promise<Payment | null> {
    const db = getDb()
    const payment = this.getById(paymentId)
    if (!payment || payment.status !== 'escrowed') return null

    const now = new Date().toISOString()

    if (config.demoMode) {
      db.prepare(`UPDATE payments SET status = 'released', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(`demo-release-${paymentId.slice(0,8)}`, now, paymentId)
      return this.getById(paymentId)
    }

    const sellerWallet = this.wallets.getById(payment.sellerWalletId)
    if (!sellerWallet) throw new Error('Seller wallet not found')

    try {
      const platformPrivKey = privateKeyFromWif(this.getPlatformPrivateKey())
      const platformAddress = this.getPlatformEscrowAddress()
      const platformWallet = this.getOrCreatePlatformWallet()
      const utxos = await this.waitForUtxos(platformWallet.id)

      const sellerPayout = payment.amount - payment.platformFee
      const txHex = await buildTransaction(utxos, [{ address: sellerWallet.address, amount: sellerPayout }], platformAddress, platformPrivKey)
      const releaseTxId = await broadcastTx(txHex)

      db.prepare(`UPDATE payments SET status = 'released', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(releaseTxId, now, paymentId)
      return this.getById(paymentId)
    } catch (error: any) {
      console.error('Failed to release payment:', error)
      throw new Error(`Failed to release payment: ${error.message}`)
    }
  }

  /**
   * Refund payment (service failed)
   * Platform returns escrowed funds to buyer
   * 
   * ⚠️ SECURITY: Internal use only. Not exposed via API.
   * Only callable from execute flow.
   */
  async refund(paymentId: string): Promise<Payment | null> {
    const db = getDb()
    const payment = this.getById(paymentId)
    if (!payment || payment.status !== 'escrowed') return null

    const now = new Date().toISOString()

    if (config.demoMode) {
      db.prepare(`UPDATE payments SET status = 'refunded', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(`demo-refund-${paymentId.slice(0,8)}`, now, paymentId)
      return this.getById(paymentId)
    }

    const buyerWallet = this.wallets.getById(payment.buyerWalletId)
    if (!buyerWallet) throw new Error('Buyer wallet not found')

    try {
      const platformPrivKey = privateKeyFromWif(this.getPlatformPrivateKey())
      const platformAddress = this.getPlatformEscrowAddress()
      const platformWallet = this.getOrCreatePlatformWallet()
      const utxos = await this.waitForUtxos(platformWallet.id)

      const txHex = await buildTransaction(utxos, [{ address: buyerWallet.address, amount: payment.amount }], platformAddress, platformPrivKey)
      const refundTxId = await broadcastTx(txHex)

      db.prepare(`UPDATE payments SET status = 'refunded', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(refundTxId, now, paymentId)
      return this.getById(paymentId)
    } catch (error: any) {
      console.error('Failed to refund payment:', error)
      throw new Error(`Failed to refund payment: ${error.message}`)
    }
  }

  /**
   * Dispute payment
   */
  dispute(paymentId: string): Payment | null {
    const db = getDb()

    const result = db.prepare(`
      UPDATE payments SET status = 'disputed'
      WHERE id = ? AND status = 'escrowed'
    `).run(paymentId)

    if (result.changes === 0) return null
    return this.getById(paymentId)
  }

  /**
   * Get payment by ID
   */
  getById(id: string): Payment | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as any
    if (!row) return null
    // Normalize DB columns to API shape
    if (!row.txId && row.escrowTxId) row.txId = row.escrowTxId
    return row as Payment
  }

  /**
   * Get payments for a wallet
   */
  getByWallet(walletId: string, role: 'buyer' | 'seller' | 'both' = 'both'): Payment[] {
    const db = getDb()
    if (role === 'buyer') {
      return db.prepare('SELECT * FROM payments WHERE buyerWalletId = ? ORDER BY createdAt DESC').all(walletId) as Payment[]
    } else if (role === 'seller') {
      return db.prepare('SELECT * FROM payments WHERE sellerWalletId = ? ORDER BY createdAt DESC').all(walletId) as Payment[]
    }
    return db.prepare('SELECT * FROM payments WHERE buyerWalletId = ? OR sellerWalletId = ? ORDER BY createdAt DESC').all(walletId, walletId) as Payment[]
  }

  private async waitForUtxos(walletId: string, attempts = 10, delayMs = 1500) {
    for (let i = 0; i < attempts; i++) {
      const utxos = await this.wallets.getUtxos(walletId)
      if (utxos.length > 0) return utxos
      await new Promise(r => setTimeout(r, delayMs))
    }
    throw new Error('Platform wallet has no UTXOs')
  }

  /**
   * Get or create platform escrow wallet
   */
  private getOrCreatePlatformWallet(): { id: string; address: string } {
    const db = getDb()

    const address = this.getPlatformEscrowAddress()

    // Check if platform wallet exists
    const existing = db.prepare('SELECT id, address FROM wallets WHERE address = ?').get(address) as any
    if (existing) return existing

    // If platform private key is configured, import it so the DB wallet matches the escrow address
    if (config.platformWallet.privateKey) {
      const wallet = this.wallets.importFromWif(config.platformWallet.privateKey)
      return { id: wallet.id, address: wallet.address }
    }

    // Fallback (dev only): create new random platform wallet (address will NOT be stable across runs)
    const wallet = this.wallets.create()
    console.warn('⚠️  Created new platform escrow wallet:', wallet.address)
    console.warn('⚠️  STORE THIS PRIVATE KEY SECURELY:', wallet.privateKey)

    return { id: wallet.id, address: wallet.address }
  }

  /**
   * Get platform escrow address
   */
  private getPlatformEscrowAddress(): string {
    if (config.platformWallet.address) return config.platformWallet.address

    if (config.platformWallet.privateKey) {
      const { deriveAddress, privateKeyFromWif } = require('../bsv/crypto')
      const priv = privateKeyFromWif(config.platformWallet.privateKey)
      return deriveAddress(priv)
    }

    // Dev fallback: ephemeral random address
    const { generatePrivateKey, deriveAddress } = require('../bsv/crypto')
    const privKey = generatePrivateKey()
    return deriveAddress(privKey)
  }

  /**
   * Get platform private key (SECURE THIS!)
   */
  private getPlatformPrivateKey(): string {
    if (config.platformWallet.privateKey) return config.platformWallet.privateKey

    // For dev/testing only - generate ephemeral key (will NOT match escrow address across calls)
    console.warn('⚠️  Using ephemeral platform key - NOT FOR PRODUCTION')
    const { generatePrivateKey } = require('../bsv/crypto')
    const privKey = generatePrivateKey()
    return privKey.toWif()
  }
}
