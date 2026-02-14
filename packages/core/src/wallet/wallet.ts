import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { getDb } from '../registry/db'
import type { AgentWallet } from '../types'
import {
  generatePrivateKey,
  deriveAddress,
  getPublicKeyHex,
  encryptPrivateKey,
  decryptPrivateKey,
  privateKeyFromWif,
  getScriptForAddress,
} from '../bsv/crypto'
import { getBalance as getOnChainBalance, getUtxos } from '../bsv/whatsonchain'
import { config } from '../config'
import type { UTXO } from '../bsv/crypto'

/**
 * BSV Wallet Manager
 *
 * Manages real BSV wallets with on-chain balance tracking.
 */
export class WalletManager {
  private hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex')
  }

  /**
   * Generate a new API key for wallet auth.
   * Returned ONLY on creation/rotation; stored hashed in DB.
   */
  generateApiKey(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  setApiKey(walletId: string, apiKey: string): void {
    const db = getDb()
    db.prepare('UPDATE wallets SET apiKeyHash = ? WHERE id = ?').run(this.hashApiKey(apiKey), walletId)
  }

  verifyApiKey(walletId: string, apiKey: string): boolean {
    const db = getDb()
    const row = db.prepare('SELECT apiKeyHash FROM wallets WHERE id = ?').get(walletId) as any
    if (!row?.apiKeyHash) return false
    return row.apiKeyHash === this.hashApiKey(apiKey)
  }

  getByApiKey(apiKey: string): AgentWallet | null {
    const db = getDb()
    const hash = this.hashApiKey(apiKey)
    const row = db.prepare('SELECT id, publicKey, address, createdAt FROM wallets WHERE apiKeyHash = ?').get(hash) as any
    return row || null
  }

  /**
   * Create a new agent wallet with real BSV keys
   */
  create(): AgentWallet & { privateKey: string; apiKey: string } {
    const db = getDb()
    const id = uuid()

    const privKey = generatePrivateKey()
    const privateKeyWif = privKey.toWif()
    const publicKey = getPublicKeyHex(privKey)
    const address = deriveAddress(privKey)

    const encryptedPrivKey = encryptPrivateKey(privateKeyWif)

    const apiKey = this.generateApiKey()
    const apiKeyHash = this.hashApiKey(apiKey)

    const createdAt = new Date().toISOString()
    db.prepare(`
      INSERT INTO wallets (id, publicKey, address, privateKey, apiKeyHash, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, publicKey, address, encryptedPrivKey, apiKeyHash, createdAt)

    return {
      id,
      publicKey,
      address,
      createdAt,
      privateKey: privateKeyWif, // Only returned on creation.
      apiKey, // Only returned on creation.
    }
  }

  /**
   * Import wallet from WIF private key
   */
  importFromWif(wif: string): AgentWallet {
    const db = getDb()
    const id = uuid()

    const privKey = privateKeyFromWif(wif)
    const publicKey = getPublicKeyHex(privKey)
    const address = deriveAddress(privKey)
    const encryptedPrivKey = encryptPrivateKey(wif)

    const existing = db.prepare('SELECT id, publicKey, address, createdAt FROM wallets WHERE address = ?').get(address) as any
    if (existing) return existing

    const createdAt = new Date().toISOString()
    db.prepare('INSERT INTO wallets (id, publicKey, address, privateKey, createdAt) VALUES (?, ?, ?, ?, ?)').run(
      id,
      publicKey,
      address,
      encryptedPrivKey,
      createdAt
    )

    // Create an API key for the imported wallet (not returned here).
    const apiKey = this.generateApiKey()
    this.setApiKey(id, apiKey)

    return { id, publicKey, address, createdAt }
  }

  /**
   * Get wallet by ID
   */
  getById(id: string): AgentWallet | null {
    const db = getDb()
    const row = db.prepare('SELECT id, publicKey, address, createdAt FROM wallets WHERE id = ?').get(id) as any
    return row || null
  }

  /**
   * Get wallet by address
   */
  getByAddress(address: string): AgentWallet | null {
    const db = getDb()
    const row = db.prepare('SELECT id, publicKey, address, createdAt FROM wallets WHERE address = ?').get(address) as any
    return row || null
  }

  /**
   * Get encrypted private key (internal use only)
   */
  getPrivateKey(walletId: string): string | null {
    const db = getDb()
    const row = db.prepare('SELECT privateKey FROM wallets WHERE id = ?').get(walletId) as any
    if (!row || !row.privateKey) return null
    return decryptPrivateKey(row.privateKey)
  }

  /**
   * Get balance from BSV blockchain via WhatsOnChain
   */
  async getBalance(walletId: string): Promise<number> {
    const wallet = this.getById(walletId)
    if (!wallet) return 0

    if (config.demoMode) {
      return this.getInternalBalance(walletId)
    }

    try {
      const balance = await getOnChainBalance(wallet.address)
      return balance.confirmed + balance.unconfirmed
    } catch (error) {
      console.error(`Failed to fetch balance for ${wallet.address}:`, error)
      return this.getInternalBalance(walletId)
    }
  }

  /**
   * Get UTXOs for a wallet
   */
  async getUtxos(walletId: string): Promise<UTXO[]> {
    const wallet = this.getById(walletId)
    if (!wallet) return []

    try {
      const wocUtxos = await getUtxos(wallet.address)

      // Derive locking script from address (P2PKH) to avoid per-UTXO tx lookups.
      const script = getScriptForAddress(wallet.address)

      const utxos: UTXO[] = wocUtxos.map(w => ({
        txid: w.tx_hash,
        vout: w.tx_pos,
        amount: w.value,
        script,
      }))

      if (utxos.length > 0) this.syncUtxos(walletId, utxos)
      return utxos.length > 0 ? utxos : this.getCachedUtxos(walletId)
    } catch (error) {
      console.error(`Failed to fetch UTXOs for ${wallet?.address}:`, error)
      return this.getCachedUtxos(walletId)
    }
  }

  /**
   * Get transaction history for a wallet
   */
  async getTxHistory(walletId: string): Promise<any[]> {
    const wallet = this.getById(walletId)
    if (!wallet) return []

    const { getTxHistory } = await import('../bsv/whatsonchain')
    try {
      return await getTxHistory(wallet.address)
    } catch (error) {
      console.error(`Failed to fetch tx history for ${wallet.address}:`, error)
      return []
    }
  }

  /**
   * Internal balance (fallback/legacy for testing)
   */
  private getInternalBalance(walletId: string): number {
    const db = getDb()

    let deposits = 0
    try {
      const dep = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE walletId = ?`).get(walletId) as any
      deposits = dep?.total || 0
    } catch {
      /* table may not exist yet */
    }

    const received = db
      .prepare(
        `
      SELECT COALESCE(SUM(amount - platformFee), 0) as total
      FROM payments WHERE sellerWalletId = ? AND status = 'released'
    `
      )
      .get(walletId) as any

    const sent = db
      .prepare(
        `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payments WHERE buyerWalletId = ? AND status IN ('released', 'escrowed')
    `
      )
      .get(walletId) as any

    return deposits + (received?.total || 0) - (sent?.total || 0)
  }

  /**
   * Sync UTXOs to local cache
   */
  private syncUtxos(walletId: string, utxos: UTXO[]): void {
    const db = getDb()

    db.prepare("UPDATE utxos SET spent = 1, spentAt = datetime('now') WHERE walletId = ? AND spent = 0").run(walletId)

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO utxos (id, walletId, txid, vout, amount, script, spent, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    for (const utxo of utxos) {
      const id = `${utxo.txid}:${utxo.vout}`
      stmt.run(id, walletId, utxo.txid, utxo.vout, utxo.amount, utxo.script)
    }
  }

  // ============ SPENDING LIMITS ============

  /**
   * Set spending limits for a wallet
   */
  setLimits(walletId: string, limits: {
    txLimit?: number | null;
    sessionLimit?: number | null;
    dailyLimit?: number | null;
  }): void {
    const db = getDb()
    const wallet = this.getById(walletId)
    if (!wallet) throw new Error('Wallet not found')

    const fields: string[] = []
    const values: any[] = []

    if ('txLimit' in limits) {
      fields.push('txLimit = ?')
      values.push(limits.txLimit)
    }
    if ('sessionLimit' in limits) {
      fields.push('sessionLimit = ?')
      values.push(limits.sessionLimit)
    }
    if ('dailyLimit' in limits) {
      fields.push('dailyLimit = ?')
      values.push(limits.dailyLimit)
    }

    if (fields.length === 0) return

    values.push(walletId)
    db.prepare(`UPDATE wallets SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  /**
   * Get spending limits for a wallet
   */
  getLimits(walletId: string): {
    txLimit: number | null;
    sessionLimit: number | null;
    dailyLimit: number | null;
    dailySpent: number;
  } {
    const db = getDb()
    const row = db.prepare(
      'SELECT txLimit, sessionLimit, dailyLimit, dailySpent, dailyResetAt FROM wallets WHERE id = ?'
    ).get(walletId) as any

    if (!row) throw new Error('Wallet not found')

    // Auto-reset daily counter if past midnight
    const now = new Date()
    const today = now.toISOString().substring(0, 10)
    const lastReset = row.dailyResetAt ? row.dailyResetAt.substring(0, 10) : null

    if (lastReset !== today) {
      db.prepare("UPDATE wallets SET dailySpent = 0, dailyResetAt = datetime('now') WHERE id = ?").run(walletId)
      return {
        txLimit: row.txLimit,
        sessionLimit: row.sessionLimit,
        dailyLimit: row.dailyLimit,
        dailySpent: 0,
      }
    }

    return {
      txLimit: row.txLimit,
      sessionLimit: row.sessionLimit,
      dailyLimit: row.dailyLimit,
      dailySpent: row.dailySpent || 0,
    }
  }

  /**
   * Check if a transaction is within spending limits
   * Returns { allowed: boolean; reason?: string }
   */
  checkLimits(walletId: string, amount: number): { allowed: boolean; reason?: string } {
    const limits = this.getLimits(walletId)

    // Check per-transaction limit
    if (limits.txLimit !== null && amount > limits.txLimit) {
      return {
        allowed: false,
        reason: `Transaction amount (${amount} sats) exceeds per-transaction limit (${limits.txLimit} sats)`,
      }
    }

    // Check daily limit
    if (limits.dailyLimit !== null && (limits.dailySpent + amount) > limits.dailyLimit) {
      return {
        allowed: false,
        reason: `Transaction would exceed daily limit (${limits.dailySpent + amount}/${limits.dailyLimit} sats)`,
      }
    }

    return { allowed: true }
  }

  /**
   * Record spending against daily limit
   */
  recordSpending(walletId: string, amount: number): void {
    const db = getDb()
    // Ensure daily counter is current
    this.getLimits(walletId)
    db.prepare('UPDATE wallets SET dailySpent = dailySpent + ? WHERE id = ?').run(amount, walletId)
  }

  /**
   * Get cached UTXOs from local database
   */
  private getCachedUtxos(walletId: string): UTXO[] {
    const db = getDb()
    const rows = db.prepare('SELECT txid, vout, amount, script FROM utxos WHERE walletId = ? AND spent = 0').all(walletId) as any[]
    return rows.map(row => ({
      txid: row.txid,
      vout: row.vout,
      amount: row.amount,
      script: row.script,
    }))
  }
}
