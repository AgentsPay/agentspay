import { v4 as uuid } from 'uuid'
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
import { getBalance as getOnChainBalance, getUtxos, getTxOutScript } from '../bsv/whatsonchain'
import { config } from '../config'
import type { UTXO } from '../bsv/crypto'
import { generateApiKey, hashApiKey } from '../middleware/auth'

/**
 * BSV Wallet Manager
 * 
 * Manages real BSV wallets with on-chain balance tracking.
 */
export class WalletManager {

  /**
   * Create a new agent wallet with real BSV keys
   * 
   * ⚠️ SECURITY: Returns privateKey and apiKey ONCE on creation only.
   * User MUST save these securely - they cannot be retrieved later.
   */
  create(): AgentWallet & { privateKey: string; apiKey: string } {
    const db = getDb()
    const id = uuid()

    // Generate real BSV private key
    const privKey = generatePrivateKey()
    const privateKeyWif = privKey.toWif()
    const publicKey = getPublicKeyHex(privKey)
    const address = deriveAddress(privKey)

    // Encrypt private key for storage
    const encryptedPrivKey = encryptPrivateKey(privateKeyWif)

    // Generate API key for authentication
    const apiKey = generateApiKey()
    const apiKeyHash = hashApiKey(apiKey)

    db.prepare(`
      INSERT INTO wallets (id, publicKey, address, privateKey, apiKeyHash, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, publicKey, address, encryptedPrivKey, apiKeyHash, new Date().toISOString())

    return {
      id,
      publicKey,
      address,
      createdAt: new Date().toISOString(),
      privateKey: privateKeyWif, // ⚠️ Only returned on creation! Store securely.
      apiKey, // ⚠️ Only returned on creation! Required for API access.
    }
  }

  /**
   * Import wallet from WIF private key
   * 
   * ⚠️ SECURITY: Returns apiKey ONCE on import only.
   */
  importFromWif(wif: string): AgentWallet & { apiKey: string } {
    const db = getDb()
    const id = uuid()
    const privKey = privateKeyFromWif(wif)
    const publicKey = getPublicKeyHex(privKey)
    const address = deriveAddress(privKey)
    const encryptedPrivKey = encryptPrivateKey(wif)
    
    // Generate API key for authentication
    const apiKey = generateApiKey()
    const apiKeyHash = hashApiKey(apiKey)
    
    // Check if already exists
    const existing = db.prepare('SELECT id, publicKey, address, createdAt FROM wallets WHERE address = ?').get(address) as any
    if (existing) {
      // Wallet exists - cannot return API key for security
      throw new Error('Wallet already exists. Cannot import duplicate.')
    }
    
    db.prepare('INSERT INTO wallets (id, publicKey, address, privateKey, apiKeyHash, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, publicKey, address, encryptedPrivKey, apiKeyHash, new Date().toISOString())
    
    return { id, publicKey, address, createdAt: new Date().toISOString(), apiKey }
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
      
      // Convert to our UTXO format - derive script from address (P2PKH)
      // This avoids rate limits from fetching each transaction
      const script = getScriptForAddress(wallet.address)
      
      const utxos: UTXO[] = wocUtxos.map(wocUtxo => ({
        txid: wocUtxo.tx_hash,
        vout: wocUtxo.tx_pos,
        amount: wocUtxo.value,
        script, // Use derived P2PKH script
      }))

      // Update local UTXO cache
      if (utxos.length > 0) {
        this.syncUtxos(walletId, utxos)
      }
      
      return utxos.length > 0 ? utxos : this.getCachedUtxos(walletId)
    } catch (error) {
      console.error(`Failed to fetch UTXOs for ${wallet.address}:`, error)
      // Fallback to cached UTXOs
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

    // Deposits (faucet/funding)
    let deposits = 0
    try {
      const dep = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE walletId = ?`).get(walletId) as any
      deposits = dep?.total || 0
    } catch { /* table may not exist yet */ }

    // Sum of received payments (released) minus sent payments
    const received = db.prepare(`
      SELECT COALESCE(SUM(amount - platformFee), 0) as total
      FROM payments WHERE sellerWalletId = ? AND status = 'released'
    `).get(walletId) as any

    const sent = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM payments WHERE buyerWalletId = ? AND status IN ('released', 'escrowed')
    `).get(walletId) as any

    return deposits + (received?.total || 0) - (sent?.total || 0)
  }

  /**
   * Sync UTXOs to local cache
   */
  private syncUtxos(walletId: string, utxos: UTXO[]): void {
    const db = getDb()
    
    // Mark all existing UTXOs as spent
    db.prepare('UPDATE utxos SET spent = 1, spentAt = datetime(\'now\') WHERE walletId = ? AND spent = 0').run(walletId)

    // Insert/update current UTXOs
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO utxos (id, walletId, txid, vout, amount, script, spent, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `)

    for (const utxo of utxos) {
      const id = `${utxo.txid}:${utxo.vout}`
      stmt.run(id, walletId, utxo.txid, utxo.vout, utxo.amount, utxo.script)
    }
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
