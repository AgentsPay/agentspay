import { v4 as uuid } from 'uuid'
import { getDb } from '../registry/db'
import { PLATFORM_FEE_RATE } from '../types'
import type { Payment, Currency } from '../types'
import { WalletManager } from '../wallet/wallet'
import { buildTransaction, privateKeyFromWif, getTxId, generatePrivateKey, deriveAddress } from '../bsv/crypto'
import { broadcastTx } from '../bsv/whatsonchain'
import { config } from '../config'
import { webhookDelivery } from '../webhooks/delivery'
import { mneeTokens } from '../bsv/mnee'
import { CurrencyManager } from '../currency/currency'

/**
 * Payment Engine with Multi-Currency Support
 * 
 * Supports:
 * - BSV (satoshis) - Native blockchain currency
 * - MNEE (USD cents) - 1Sat Ordinals BSV-21 stablecoin token
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
   * Create a payment (escrow funds)
   * Supports both BSV (satoshis) and MNEE (USD cents)
   */
  async create(serviceId: string, buyerWalletId: string, sellerWalletId: string, amount: number, currency: Currency = 'BSV'): Promise<Payment> {
    const db = getDb()
    const id = uuid()
    const platformFee = CurrencyManager.calculateFee(amount, currency)
    const now = new Date().toISOString()

    if (!CurrencyManager.validateAmount(amount, currency)) {
      throw new Error(`Invalid ${currency} amount`)
    }

    if (config.demoMode) {
      // Demo mode: internal ledger, no on-chain tx
      db.prepare(`
        INSERT INTO payments (id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'escrowed', ?, ?)
      `).run(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency, `demo-${currency}-${id.slice(0,8)}`, now)

      const payment: Payment = {
        id, serviceId, buyerWalletId, sellerWalletId,
        amount, platformFee, currency, status: 'escrowed',
        txId: `demo-${currency}-${id.slice(0,8)}`,
        createdAt: now,
      }

      // Trigger webhooks
      webhookDelivery.trigger('payment.created', payment).catch(console.error)
      webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)

      return payment
    }

    // On-chain mode - handle BSV or MNEE
    if (currency === 'BSV') {
      return this.createBsvPayment(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, now)
    } else if (currency === 'MNEE') {
      return this.createMneePayment(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, now)
    } else {
      throw new Error(`Unsupported currency: ${currency}`)
    }
  }

  /**
   * Create BSV payment (on-chain)
   */
  private async createBsvPayment(
    id: string,
    serviceId: string,
    buyerWalletId: string,
    sellerWalletId: string,
    amount: number,
    platformFee: number,
    now: string
  ): Promise<Payment> {
    const db = getDb()
    const buyerWallet = this.wallets.getById(buyerWalletId)
    if (!buyerWallet) throw new Error('Buyer wallet not found')

    const buyerPrivKeyWif = this.wallets.getPrivateKey(buyerWalletId)
    if (!buyerPrivKeyWif) throw new Error('Cannot access buyer private key')

    const buyerPrivKey = privateKeyFromWif(buyerPrivKeyWif)
    const utxos = await this.wallets.getUtxos(buyerWalletId)
    if (utxos.length === 0) throw new Error('No UTXOs available. Please fund your wallet.')

    const totalAvailable = utxos.reduce((sum, utxo) => sum + utxo.amount, 0)
    if (totalAvailable < amount) throw new Error(`Insufficient BSV. Need ${amount} sats, have ${totalAvailable} sats`)

    const platformAddress = this.getPlatformEscrowAddress()

    try {
      const txHex = await buildTransaction(utxos, [{ address: platformAddress, amount }], buyerWallet.address, buyerPrivKey)
      const txId = await broadcastTx(txHex)

      db.prepare(`
        INSERT INTO payments (id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'BSV', 'escrowed', ?, ?)
      `).run(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, txId, now)

      const payment: Payment = { id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency: 'BSV', status: 'escrowed', txId, createdAt: now }

      webhookDelivery.trigger('payment.created', payment).catch(console.error)
      webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)

      return payment
    } catch (error: any) {
      throw new Error(`Failed to create BSV escrow transaction: ${error.message}`)
    }
  }

  /**
   * Create MNEE payment (token transfer)
   */
  private async createMneePayment(
    id: string,
    serviceId: string,
    buyerWalletId: string,
    sellerWalletId: string,
    amount: number,
    platformFee: number,
    now: string
  ): Promise<Payment> {
    const db = getDb()
    const buyerWallet = this.wallets.getById(buyerWalletId)
    if (!buyerWallet) throw new Error('Buyer wallet not found')

    const buyerPrivKeyWif = this.wallets.getPrivateKey(buyerWalletId)
    if (!buyerPrivKeyWif) throw new Error('Cannot access buyer private key')

    // Check MNEE balance
    const mneeBalance = await mneeTokens.getBalance(buyerWallet.address)
    if (mneeBalance < amount) {
      throw new Error(`Insufficient MNEE balance. Need ${amount} cents ($${(amount/100).toFixed(2)}), have ${mneeBalance} cents ($${(mneeBalance/100).toFixed(2)})`)
    }

    // Get platform escrow address for MNEE
    const platformAddress = this.getPlatformEscrowAddress()

    try {
      // Transfer MNEE tokens to platform escrow
      const result = await mneeTokens.transfer(buyerWallet.address, platformAddress, amount, buyerPrivKeyWif)

      db.prepare(`
        INSERT INTO payments (id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'MNEE', 'escrowed', ?, ?)
      `).run(id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, result.txid, now)

      const payment: Payment = { id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency: 'MNEE', status: 'escrowed', txId: result.txid, createdAt: now }

      webhookDelivery.trigger('payment.created', payment).catch(console.error)
      webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)

      return payment
    } catch (error: any) {
      throw new Error(`Failed to create MNEE escrow: ${error.message}`)
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
        .run(`demo-release-${payment.currency}-${paymentId.slice(0,8)}`, now, paymentId)
      const updatedPayment = this.getById(paymentId)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.completed', updatedPayment).catch(console.error)
      }
      return updatedPayment
    }

    // On-chain release - handle BSV or MNEE
    if (payment.currency === 'BSV') {
      return this.releaseBsvPayment(payment, now)
    } else if (payment.currency === 'MNEE') {
      return this.releaseMneePayment(payment, now)
    } else {
      throw new Error(`Unsupported currency: ${payment.currency}`)
    }
  }

  /**
   * Release BSV payment
   */
  private async releaseBsvPayment(payment: Payment, now: string): Promise<Payment | null> {
    const db = getDb()
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
        .run(releaseTxId, now, payment.id)
      const updatedPayment = this.getById(payment.id)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.completed', updatedPayment).catch(console.error)
      }
      return updatedPayment
    } catch (error: any) {
      console.error('Failed to release BSV payment:', error)
      throw new Error(`Failed to release BSV payment: ${error.message}`)
    }
  }

  /**
   * Release MNEE payment
   */
  private async releaseMneePayment(payment: Payment, now: string): Promise<Payment | null> {
    const db = getDb()
    const sellerWallet = this.wallets.getById(payment.sellerWalletId)
    if (!sellerWallet) throw new Error('Seller wallet not found')

    const platformAddress = this.getPlatformEscrowAddress()
    const platformPrivKey = this.getPlatformPrivateKey()

    try {
      const sellerPayout = payment.amount - payment.platformFee
      const result = await mneeTokens.transfer(platformAddress, sellerWallet.address, sellerPayout, platformPrivKey)

      db.prepare(`UPDATE payments SET status = 'released', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(result.txid, now, payment.id)
      const updatedPayment = this.getById(payment.id)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.completed', updatedPayment).catch(console.error)
      }
      return updatedPayment
    } catch (error: any) {
      console.error('Failed to release MNEE payment:', error)
      throw new Error(`Failed to release MNEE payment: ${error.message}`)
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
        .run(`demo-refund-${payment.currency}-${paymentId.slice(0,8)}`, now, paymentId)
      const updatedPayment = this.getById(paymentId)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.failed', updatedPayment).catch(console.error)
        webhookDelivery.trigger('payment.refunded', updatedPayment).catch(console.error)
      }
      return updatedPayment
    }

    // On-chain refund - handle BSV or MNEE
    if (payment.currency === 'BSV') {
      return this.refundBsvPayment(payment, now)
    } else if (payment.currency === 'MNEE') {
      return this.refundMneePayment(payment, now)
    } else {
      throw new Error(`Unsupported currency: ${payment.currency}`)
    }
  }

  /**
   * Refund BSV payment
   */
  private async refundBsvPayment(payment: Payment, now: string): Promise<Payment | null> {
    const db = getDb()
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
        .run(refundTxId, now, payment.id)
      const updatedPayment = this.getById(payment.id)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.failed', updatedPayment).catch(console.error)
        webhookDelivery.trigger('payment.refunded', updatedPayment).catch(console.error)
      }
      return updatedPayment
    } catch (error: any) {
      console.error('Failed to refund BSV payment:', error)
      throw new Error(`Failed to refund BSV payment: ${error.message}`)
    }
  }

  /**
   * Refund MNEE payment
   */
  private async refundMneePayment(payment: Payment, now: string): Promise<Payment | null> {
    const db = getDb()
    const buyerWallet = this.wallets.getById(payment.buyerWalletId)
    if (!buyerWallet) throw new Error('Buyer wallet not found')

    const platformAddress = this.getPlatformEscrowAddress()
    const platformPrivKey = this.getPlatformPrivateKey()

    try {
      const result = await mneeTokens.transfer(platformAddress, buyerWallet.address, payment.amount, platformPrivKey)

      db.prepare(`UPDATE payments SET status = 'refunded', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(result.txid, now, payment.id)
      const updatedPayment = this.getById(payment.id)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.failed', updatedPayment).catch(console.error)
        webhookDelivery.trigger('payment.refunded', updatedPayment).catch(console.error)
      }
      return updatedPayment
    } catch (error: any) {
      console.error('Failed to refund MNEE payment:', error)
      throw new Error(`Failed to refund MNEE payment: ${error.message}`)
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
    const payment = this.getById(paymentId)
    if (payment) {
      webhookDelivery.trigger('dispute.opened', payment).catch(console.error)
    }
    return payment
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
    if (!row.currency) row.currency = 'BSV' // default for legacy payments
    return row as Payment
  }

  /**
   * Get payments for a wallet
   */
  getByWallet(walletId: string, role: 'buyer' | 'seller' | 'both' = 'both'): Payment[] {
    const db = getDb()
    let rows: any[]
    if (role === 'buyer') {
      rows = db.prepare('SELECT * FROM payments WHERE buyerWalletId = ? ORDER BY createdAt DESC').all(walletId) as any[]
    } else if (role === 'seller') {
      rows = db.prepare('SELECT * FROM payments WHERE sellerWalletId = ? ORDER BY createdAt DESC').all(walletId) as any[]
    } else {
      rows = db.prepare('SELECT * FROM payments WHERE buyerWalletId = ? OR sellerWalletId = ? ORDER BY createdAt DESC').all(walletId, walletId) as any[]
    }
    
    // Normalize legacy payments without currency field
    return rows.map(row => ({
      ...row,
      currency: row.currency || 'BSV'
    })) as Payment[]
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
      const priv = privateKeyFromWif(config.platformWallet.privateKey)
      return deriveAddress(priv)
    }

    // Dev fallback: ephemeral random address
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
    const privKey = generatePrivateKey()
    return privKey.toWif()
  }
}
