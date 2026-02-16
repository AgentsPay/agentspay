import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { BSM, PrivateKey, PublicKey, Signature } from '@bsv/sdk'
import { getDb } from '../registry/db'
import type { Payment, Currency } from '../types'
import { WalletManager } from '../wallet/wallet'
import {
  buildTransaction,
  privateKeyFromWif,
  generatePrivateKey,
  deriveAddress,
  buildMultisigLockingScript,
  buildTransactionToLockingScript,
  spendMultisigUtxo,
  getMultisigSigningPayload,
} from '../bsv/crypto'
import { broadcastTx } from '../bsv/whatsonchain'
import { config } from '../config'
import { webhookDelivery } from '../webhooks/delivery'
import { mneeTokens } from '../bsv/mnee'
import { CurrencyManager } from '../currency/currency'

export type SettlementAction = 'release' | 'refund'
export type SettlementActorType = 'buyer' | 'provider' | 'admin'

export interface SettlementApproval {
  id: number
  paymentId: string
  action: SettlementAction
  actorType: SettlementActorType
  actorId: string
  signature: string
  message: string
  createdAt: string
}

export interface AdminMultisigSigningPayload {
  action: SettlementAction
  paymentId: string
  digestHex: string
  preimageHex: string
  txHex: string
  sighashType: number
}

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

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map((v) => this.stableStringify(v)).join(',')}]`
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.stableStringify(obj[k])}`).join(',')}}`
  }

  private signMessage(message: string, privateKeyWif: string): string {
    const bytes = Array.from(Buffer.from(message, 'utf8'))
    const priv = PrivateKey.fromWif(privateKeyWif)
    return BSM.sign(bytes, priv, 'base64') as string
  }

  private verifyMessage(message: string, signatureBase64: string, publicKeyHex: string): boolean {
    try {
      const bytes = Array.from(Buffer.from(message, 'utf8'))
      const sig = Signature.fromCompact(signatureBase64, 'base64')
      const pub = PublicKey.fromString(publicKeyHex)
      return BSM.verify(bytes, sig, pub)
    } catch {
      return false
    }
  }

  private rowToSettlementApproval(row: any): SettlementApproval {
    return {
      id: row.id,
      paymentId: row.paymentId,
      action: row.action,
      actorType: row.actorType,
      actorId: row.actorId,
      signature: row.signature,
      message: row.message,
      createdAt: row.createdAt,
    }
  }

  private getExpectedSettlementMessage(payment: Payment, action: SettlementAction): string {
    const payload = {
      version: 1,
      domain: 'agentpay.settlement.approval',
      paymentId: payment.id,
      contractId: payment.contractId || null,
      serviceId: payment.serviceId,
      buyerWalletId: payment.buyerWalletId,
      sellerWalletId: payment.sellerWalletId,
      amount: payment.amount,
      platformFee: payment.platformFee,
      currency: payment.currency,
      action,
    }
    const payloadHash = crypto.createHash('sha256').update(this.stableStringify(payload)).digest('hex')
    return `AgentPaySettlement:${payloadHash}`
  }

  private getDistinctApprovalActorTypes(paymentId: string, action: SettlementAction): SettlementActorType[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT DISTINCT actorType
      FROM settlement_approvals
      WHERE paymentId = ? AND action = ?
    `).all(paymentId, action) as Array<{ actorType: SettlementActorType }>
    return rows.map((r) => r.actorType)
  }

  private ensureSettlementQuorum(paymentId: string, action: SettlementAction): void {
    let actorTypes = this.getDistinctApprovalActorTypes(paymentId, action)
    if (actorTypes.length >= 2) return
    this.seedDefaultApprovals(paymentId)
    actorTypes = this.getDistinctApprovalActorTypes(paymentId, action)
    if (actorTypes.length >= 2) return
    throw new Error(
      `Settlement quorum not met for '${action}'. Need 2-of-3 (buyer/provider/admin), have ${actorTypes.length}.`
    )
  }

  private seedDefaultApprovals(paymentId: string): void {
    try {
      this.createAutoWalletApproval(paymentId, 'release', 'buyer')
      this.createAutoWalletApproval(paymentId, 'refund', 'buyer')
      this.createAutoWalletApproval(paymentId, 'refund', 'provider')
    } catch (e) {
      console.error(`[Settlement] Failed to seed default approvals for payment ${paymentId}:`, e)
    }
  }

  /**
   * Create a payment (escrow funds)
   * Supports both BSV (satoshis) and MNEE (USD cents)
   */
  async create(
    serviceId: string,
    buyerWalletId: string,
    sellerWalletId: string,
    amount: number,
    currency: Currency = 'BSV',
    contractId: string | null = null
  ): Promise<Payment> {
    const db = getDb()
    const id = uuid()
    const platformFee = CurrencyManager.calculateFee(amount, currency)
    const now = new Date().toISOString()

    if (!CurrencyManager.validateAmount(amount, currency)) {
      throw new Error(`Invalid ${currency} amount`)
    }

    // Check spending limits before proceeding
    const limitCheck = this.wallets.checkLimits(buyerWalletId, amount)
    if (!limitCheck.allowed) {
      throw new Error(`Spending limit exceeded: ${limitCheck.reason}`)
    }

    // Record spending against daily limit
    this.wallets.recordSpending(buyerWalletId, amount)

    if (config.demoMode) {
      // Demo mode: internal ledger, no on-chain tx
      db.prepare(`
        INSERT INTO payments (id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, currency, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'escrowed', ?, ?)
      `).run(id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, currency, `demo-${currency}-${id.slice(0,8)}`, now)

      const payment: Payment = {
        id, serviceId, buyerWalletId, sellerWalletId,
        amount, platformFee, currency, status: 'escrowed',
        txId: `demo-${currency}-${id.slice(0,8)}`,
        createdAt: now,
      }

      // Trigger webhooks
      webhookDelivery.trigger('payment.created', payment).catch(console.error)
      webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)
      this.seedDefaultApprovals(id)

      return payment
    }

    // On-chain mode - handle BSV or MNEE
    if (currency === 'BSV') {
      return this.createBsvPayment(id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, now)
    } else if (currency === 'MNEE') {
      return this.createMneePayment(id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, now)
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
    contractId: string | null,
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

    try {
      if (config.escrowMode === 'multisig') {
        const sellerWallet = this.wallets.getById(sellerWalletId)
        if (!sellerWallet) throw new Error('Seller wallet not found')

        const adminPubKey = this.getAdminMultisigPublicKey()
        const lockingScript = buildMultisigLockingScript([buyerWallet.publicKey, sellerWallet.publicKey, adminPubKey], 2)
        const { txHex, escrowVout } = await buildTransactionToLockingScript(
          utxos,
          lockingScript,
          amount,
          buyerWallet.address,
          buyerPrivKey
        )
        const txId = await broadcastTx(txHex)

        db.prepare(`
          INSERT INTO payments (
            id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee,
            currency, status, escrowTxId, escrowVout, escrowScript, escrowMode, createdAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'BSV', 'escrowed', ?, ?, ?, 'multisig', ?)
        `).run(
          id,
          serviceId,
          contractId,
          buyerWalletId,
          sellerWalletId,
          amount,
          platformFee,
          txId,
          escrowVout,
          lockingScript.toHex(),
          now
        )

        const payment: Payment = {
          id,
          serviceId,
          buyerWalletId,
          sellerWalletId,
          amount,
          platformFee,
          currency: 'BSV',
          status: 'escrowed',
          txId,
          escrowTxId: txId,
          escrowVout,
          escrowScript: lockingScript.toHex(),
          escrowMode: 'multisig',
          createdAt: now,
        }

        webhookDelivery.trigger('payment.created', payment).catch(console.error)
        webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)
        this.seedDefaultApprovals(id)
        return payment
      }

      const platformAddress = this.getPlatformEscrowAddress()
      const txHex = await buildTransaction(utxos, [{ address: platformAddress, amount }], buyerWallet.address, buyerPrivKey)
      const txId = await broadcastTx(txHex)

      db.prepare(`
        INSERT INTO payments (id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, currency, status, escrowTxId, escrowMode, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'BSV', 'escrowed', ?, 'platform', ?)
      `).run(id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, txId, now)

      const payment: Payment = {
        id,
        serviceId,
        buyerWalletId,
        sellerWalletId,
        amount,
        platformFee,
        currency: 'BSV',
        status: 'escrowed',
        txId,
        escrowTxId: txId,
        escrowMode: 'platform',
        createdAt: now,
      }

      webhookDelivery.trigger('payment.created', payment).catch(console.error)
      webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)
      this.seedDefaultApprovals(id)

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
    contractId: string | null,
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
        INSERT INTO payments (id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, currency, status, escrowTxId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'MNEE', 'escrowed', ?, ?)
      `).run(id, serviceId, contractId, buyerWalletId, sellerWalletId, amount, platformFee, result.txid, now)

      const payment: Payment = { id, serviceId, buyerWalletId, sellerWalletId, amount, platformFee, currency: 'MNEE', status: 'escrowed', txId: result.txid, createdAt: now }

      webhookDelivery.trigger('payment.created', payment).catch(console.error)
      webhookDelivery.trigger('payment.escrowed', payment).catch(console.error)
      this.seedDefaultApprovals(id)

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
  async release(paymentId: string, opts?: { adminTxSignatureHex?: string }): Promise<Payment | null> {
    const db = getDb()
    const payment = this.getById(paymentId)
    if (!payment || payment.status !== 'escrowed') return null
    this.ensureSettlementQuorum(paymentId, 'release')

    const now = new Date().toISOString()

    if (config.demoMode) {
      db.prepare(`UPDATE payments SET status = 'released', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(`demo-release-${payment.currency}-${paymentId.slice(0,8)}`, now, paymentId)
      this.updateContractStatus(paymentId, 'released', `demo-release-${payment.currency}-${paymentId.slice(0,8)}`)
      const updatedPayment = this.getById(paymentId)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.completed', updatedPayment).catch(console.error)
      }
      return updatedPayment
    }

    // On-chain release - handle BSV or MNEE
    if (payment.currency === 'BSV') {
      return this.releaseBsvPayment(payment, now, opts)
    } else if (payment.currency === 'MNEE') {
      return this.releaseMneePayment(payment, now)
    } else {
      throw new Error(`Unsupported currency: ${payment.currency}`)
    }
  }

  /**
   * Release BSV payment
   */
  private async releaseBsvPayment(payment: Payment, now: string, opts?: { adminTxSignatureHex?: string }): Promise<Payment | null> {
    if ((payment.escrowMode || 'platform') === 'multisig') {
      return this.releaseBsvMultisigPayment(payment, now, opts)
    }

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
      this.updateContractStatus(payment.id, 'released', releaseTxId)
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
      this.updateContractStatus(payment.id, 'released', result.txid)
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
  async refund(paymentId: string, opts?: { adminTxSignatureHex?: string }): Promise<Payment | null> {
    const db = getDb()
    const payment = this.getById(paymentId)
    if (!payment || payment.status !== 'escrowed') return null
    this.ensureSettlementQuorum(paymentId, 'refund')

    const now = new Date().toISOString()

    if (config.demoMode) {
      db.prepare(`UPDATE payments SET status = 'refunded', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(`demo-refund-${payment.currency}-${paymentId.slice(0,8)}`, now, paymentId)
      this.updateContractStatus(paymentId, 'refunded', `demo-refund-${payment.currency}-${paymentId.slice(0,8)}`)
      const updatedPayment = this.getById(paymentId)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.failed', updatedPayment).catch(console.error)
        webhookDelivery.trigger('payment.refunded', updatedPayment).catch(console.error)
      }
      return updatedPayment
    }

    // On-chain refund - handle BSV or MNEE
    if (payment.currency === 'BSV') {
      return this.refundBsvPayment(payment, now, opts)
    } else if (payment.currency === 'MNEE') {
      return this.refundMneePayment(payment, now)
    } else {
      throw new Error(`Unsupported currency: ${payment.currency}`)
    }
  }

  /**
   * Refund BSV payment
   */
  private async refundBsvPayment(payment: Payment, now: string, opts?: { adminTxSignatureHex?: string }): Promise<Payment | null> {
    if ((payment.escrowMode || 'platform') === 'multisig') {
      return this.refundBsvMultisigPayment(payment, now, opts)
    }

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
      this.updateContractStatus(payment.id, 'refunded', refundTxId)
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
      this.updateContractStatus(payment.id, 'refunded', result.txid)
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
   * Dispute payment (works on escrowed or released payments within dispute window)
   */
  dispute(paymentId: string): Payment | null {
    const db = getDb()

    const result = db.prepare(`
      UPDATE payments SET status = 'disputed'
      WHERE id = ? AND status IN ('escrowed', 'released')
    `).run(paymentId)

    if (result.changes === 0) return null
    this.updateContractStatus(paymentId, 'disputed')
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
    if (!row.escrowMode) row.escrowMode = 'platform'
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
      currency: row.currency || 'BSV',
      escrowMode: row.escrowMode || 'platform',
    })) as Payment[]
  }

  getSettlementMessage(paymentId: string, action: SettlementAction): string {
    const payment = this.getById(paymentId)
    if (!payment) throw new Error('Payment not found')
    return this.getExpectedSettlementMessage(payment, action)
  }

  createAutoWalletApproval(paymentId: string, action: SettlementAction, actorType: 'buyer' | 'provider'): SettlementApproval {
    const payment = this.getById(paymentId)
    if (!payment) throw new Error('Payment not found')

    const actorWalletId = actorType === 'buyer' ? payment.buyerWalletId : payment.sellerWalletId
    const wallet = this.wallets.getById(actorWalletId)
    if (!wallet) throw new Error(`${actorType} wallet not found`)

    const privateKeyWif = this.wallets.getPrivateKey(actorWalletId)
    if (!privateKeyWif) throw new Error(`Cannot access ${actorType} private key`)

    const message = this.getExpectedSettlementMessage(payment, action)
    const signature = this.signMessage(message, privateKeyWif)
    if (!this.verifyMessage(message, signature, wallet.publicKey)) {
      throw new Error(`Invalid ${actorType} settlement signature`)
    }

    return this.recordApproval(paymentId, action, actorType, actorWalletId, signature, message)
  }

  createWalletApproval(
    paymentId: string,
    action: SettlementAction,
    walletId: string,
    signature: string
  ): SettlementApproval {
    const payment = this.getById(paymentId)
    if (!payment) throw new Error('Payment not found')

    let actorType: 'buyer' | 'provider'
    if (walletId === payment.buyerWalletId) {
      actorType = 'buyer'
    } else if (walletId === payment.sellerWalletId) {
      actorType = 'provider'
    } else {
      throw new Error('Only buyer or provider can approve settlement')
    }

    const wallet = this.wallets.getById(walletId)
    if (!wallet) throw new Error('Wallet not found')

    const message = this.getExpectedSettlementMessage(payment, action)
    if (!this.verifyMessage(message, signature, wallet.publicKey)) {
      throw new Error('Invalid wallet settlement signature')
    }

    return this.recordApproval(paymentId, action, actorType, walletId, signature, message)
  }

  createAdminApproval(
    paymentId: string,
    action: SettlementAction,
    adminAddress: string,
    signature: string
  ): SettlementApproval {
    const payment = this.getById(paymentId)
    if (!payment) throw new Error('Payment not found')
    const message = this.getExpectedSettlementMessage(payment, action)
    return this.recordApproval(paymentId, action, 'admin', adminAddress, signature, message)
  }

  getSettlementApprovals(paymentId: string, action?: SettlementAction): SettlementApproval[] {
    const db = getDb()
    const rows = action
      ? db.prepare(`
        SELECT id, paymentId, action, actorType, actorId, signature, message, createdAt
        FROM settlement_approvals
        WHERE paymentId = ? AND action = ?
        ORDER BY createdAt ASC, id ASC
      `).all(paymentId, action)
      : db.prepare(`
        SELECT id, paymentId, action, actorType, actorId, signature, message, createdAt
        FROM settlement_approvals
        WHERE paymentId = ?
        ORDER BY createdAt ASC, id ASC
      `).all(paymentId)

    return (rows as any[]).map((r) => this.rowToSettlementApproval(r))
  }

  getSettlementQuorum(paymentId: string, action: SettlementAction): {
    action: SettlementAction
    required: number
    ready: boolean
    actorTypes: SettlementActorType[]
    approvals: SettlementApproval[]
  } {
    const actorTypes = this.getDistinctApprovalActorTypes(paymentId, action)
    return {
      action,
      required: 2,
      ready: actorTypes.length >= 2,
      actorTypes,
      approvals: this.getSettlementApprovals(paymentId, action),
    }
  }

  private buildMultisigReleaseOutputs(payment: Payment, sellerAddress: string): Array<{ address: string; amount: number }> {
    const spendableAfterFee = Math.max(0, payment.amount - 420)
    const desiredSeller = Math.max(0, payment.amount - payment.platformFee)
    let sellerAmount = Math.min(desiredSeller, spendableAfterFee)
    if (sellerAmount <= 0) throw new Error('Insufficient escrow amount for release after fee')

    const outputs: Array<{ address: string; amount: number }> = [{ address: sellerAddress, amount: sellerAmount }]
    const leftover = spendableAfterFee - sellerAmount
    if (leftover > 546) {
      outputs.push({ address: this.getPlatformEscrowAddress(), amount: leftover })
    } else if (leftover > 0) {
      outputs[0]!.amount += leftover
    }
    return outputs
  }

  private buildMultisigRefundOutputs(payment: Payment, buyerAddress: string): Array<{ address: string; amount: number }> {
    const refundAmount = payment.amount > 600 ? payment.amount - 420 : Math.max(1, payment.amount - 200)
    return [{ address: buyerAddress, amount: refundAmount }]
  }

  getAdminMultisigSigningPayload(paymentId: string, action: SettlementAction): AdminMultisigSigningPayload | null {
    const payment = this.getById(paymentId)
    if (!payment || payment.currency !== 'BSV' || (payment.escrowMode || 'platform') !== 'multisig') {
      return null
    }
    if (!payment.escrowTxId || payment.escrowVout === undefined || !payment.escrowScript) {
      throw new Error('Missing multisig escrow metadata on payment')
    }

    const sellerWallet = this.wallets.getById(payment.sellerWalletId)
    const buyerWallet = this.wallets.getById(payment.buyerWalletId)
    if (!sellerWallet || !buyerWallet) throw new Error('Payment wallets not found')

    const outputs = action === 'release'
      ? this.buildMultisigReleaseOutputs(payment, sellerWallet.address)
      : this.buildMultisigRefundOutputs(payment, buyerWallet.address)

    const signing = getMultisigSigningPayload({
      utxo: { txid: payment.escrowTxId, vout: payment.escrowVout, amount: payment.amount },
      lockingScriptHex: payment.escrowScript,
      outputs,
    })

    return {
      action,
      paymentId: payment.id,
      digestHex: signing.digestHex,
      preimageHex: signing.preimageHex,
      txHex: signing.txHex,
      sighashType: signing.sighashType,
    }
  }

  private async releaseBsvMultisigPayment(payment: Payment, now: string, opts?: { adminTxSignatureHex?: string }): Promise<Payment | null> {
    const db = getDb()
    const sellerWallet = this.wallets.getById(payment.sellerWalletId)
    if (!sellerWallet) throw new Error('Seller wallet not found')
    if (!payment.escrowTxId || payment.escrowVout === undefined || !payment.escrowScript) {
      throw new Error('Missing multisig escrow metadata on payment')
    }

    try {
      const sellerPrivWif = this.wallets.getPrivateKey(payment.sellerWalletId)
      if (!sellerPrivWif) throw new Error('Cannot access seller private key')
      const outputs = this.buildMultisigReleaseOutputs(payment, sellerWallet.address)
      const signerPrivateKeys = [privateKeyFromWif(sellerPrivWif)]
      const signerPublicKeys: string[] = []
      const providedChecksigSignaturesHex: string[] = []
      if (opts?.adminTxSignatureHex) {
        signerPublicKeys.push(this.getAdminMultisigPublicKey())
        providedChecksigSignaturesHex.push(opts.adminTxSignatureHex)
      } else {
        const buyerPrivWif = this.wallets.getPrivateKey(payment.buyerWalletId)
        if (!buyerPrivWif) throw new Error('Cannot access buyer private key')
        signerPrivateKeys.push(privateKeyFromWif(buyerPrivWif))
      }

      const txHex = await spendMultisigUtxo({
        utxo: { txid: payment.escrowTxId, vout: payment.escrowVout, amount: payment.amount },
        lockingScriptHex: payment.escrowScript,
        signerPrivateKeys,
        signerPublicKeys,
        providedChecksigSignaturesHex,
        outputs,
      })
      const releaseTxId = await broadcastTx(txHex)

      db.prepare(`UPDATE payments SET status = 'released', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(releaseTxId, now, payment.id)
      this.updateContractStatus(payment.id, 'released', releaseTxId)
      const updatedPayment = this.getById(payment.id)
      if (updatedPayment) webhookDelivery.trigger('payment.completed', updatedPayment).catch(console.error)
      return updatedPayment
    } catch (error: any) {
      console.error('Failed to release multisig BSV payment:', error)
      throw new Error(`Failed to release multisig BSV payment: ${error.message}`)
    }
  }

  private async refundBsvMultisigPayment(payment: Payment, now: string, opts?: { adminTxSignatureHex?: string }): Promise<Payment | null> {
    const db = getDb()
    const buyerWallet = this.wallets.getById(payment.buyerWalletId)
    if (!buyerWallet) throw new Error('Buyer wallet not found')
    if (!payment.escrowTxId || payment.escrowVout === undefined || !payment.escrowScript) {
      throw new Error('Missing multisig escrow metadata on payment')
    }

    try {
      const buyerPrivWif = this.wallets.getPrivateKey(payment.buyerWalletId)
      if (!buyerPrivWif) throw new Error('Cannot access buyer private key')
      const outputs = this.buildMultisigRefundOutputs(payment, buyerWallet.address)
      const signerPrivateKeys = [privateKeyFromWif(buyerPrivWif)]
      const signerPublicKeys: string[] = []
      const providedChecksigSignaturesHex: string[] = []
      if (opts?.adminTxSignatureHex) {
        signerPublicKeys.push(this.getAdminMultisigPublicKey())
        providedChecksigSignaturesHex.push(opts.adminTxSignatureHex)
      } else {
        const sellerPrivWif = this.wallets.getPrivateKey(payment.sellerWalletId)
        if (!sellerPrivWif) throw new Error('Cannot access provider private key')
        signerPrivateKeys.push(privateKeyFromWif(sellerPrivWif))
      }

      const txHex = await spendMultisigUtxo({
        utxo: { txid: payment.escrowTxId, vout: payment.escrowVout, amount: payment.amount },
        lockingScriptHex: payment.escrowScript,
        signerPrivateKeys,
        signerPublicKeys,
        providedChecksigSignaturesHex,
        outputs,
      })
      const refundTxId = await broadcastTx(txHex)

      db.prepare(`UPDATE payments SET status = 'refunded', releaseTxId = ?, completedAt = ? WHERE id = ?`)
        .run(refundTxId, now, payment.id)
      this.updateContractStatus(payment.id, 'refunded', refundTxId)
      const updatedPayment = this.getById(payment.id)
      if (updatedPayment) {
        webhookDelivery.trigger('payment.failed', updatedPayment).catch(console.error)
        webhookDelivery.trigger('payment.refunded', updatedPayment).catch(console.error)
      }
      return updatedPayment
    } catch (error: any) {
      console.error('Failed to refund multisig BSV payment:', error)
      throw new Error(`Failed to refund multisig BSV payment: ${error.message}`)
    }
  }

  private recordApproval(
    paymentId: string,
    action: SettlementAction,
    actorType: SettlementActorType,
    actorId: string,
    signature: string,
    message: string
  ): SettlementApproval {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO settlement_approvals (paymentId, action, actorType, actorId, signature, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(paymentId, action, actorType, actorId, signature, message)

    const row = db.prepare(`
      SELECT id, paymentId, action, actorType, actorId, signature, message, createdAt
      FROM settlement_approvals
      WHERE paymentId = ? AND action = ? AND actorType = ? AND actorId = ?
    `).get(paymentId, action, actorType, actorId) as any

    if (!row) throw new Error('Failed to store settlement approval')
    return this.rowToSettlementApproval(row)
  }

  private async waitForUtxos(walletId: string, attempts = 10, delayMs = 1500) {
    for (let i = 0; i < attempts; i++) {
      const utxos = await this.wallets.getUtxos(walletId)
      if (utxos.length > 0) return utxos
      await new Promise(r => setTimeout(r, delayMs))
    }
    throw new Error('Platform wallet has no UTXOs')
  }

  private updateContractStatus(paymentId: string, status: 'released' | 'refunded' | 'disputed', settlementTxId?: string): void {
    const db = getDb()
    db.prepare(`
      UPDATE service_contracts
      SET status = ?, settlementTxId = ?, settledAt = ?
      WHERE id = (SELECT contractId FROM payments WHERE id = ?)
    `).run(status, settlementTxId || null, new Date().toISOString(), paymentId)
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

  private getAdminMultisigPublicKey(): string {
    const pub = process.env.AGENTPAY_ADMIN_MULTISIG_PUBKEY
    if (!pub) {
      throw new Error('AGENTPAY_ADMIN_MULTISIG_PUBKEY is required for multisig escrow mode')
    }
    return pub.trim()
  }

}
