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
} from '../bsv/crypto'
import { getBalance as getOnChainBalance, getUtxos, getTxOutScript } from '../bsv/whatsonchain'
import { config } from '../config'
import type { UTXO } from '../bsv/crypto'

/**
 * BSV Wallet Manager
 * 
 * Manages real BSV wallets with on-chain balance tracking.
 */
export class WalletManager {

  /**
   * Create a new agent wallet with real BSV keys
   */
  create(): AgentWallet & { privateKey: string } {
    const db = getDb()
    const id = uuid()

    // Generate real BSV private key
    const privKey = generatePrivateKey()
    const privateKeyWif = privKey.toWif()
    const publicKey = getPublicKeyHex(privKey)
    const address = deriveAddress(privKey)

    // Encrypt private key for storage
    const encryptedPrivKey = encryptPrivateKey(privateKeyWif)

    db.prepare(`
      INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, publicKey, address, encryptedPrivKey, new Date().toISOString())

    return {
      id,
      publicKey,
      address,
      createdAt: new Date().toISOString(),
      privateKey: privateKeyWif, // Only returned on creation! Store securely.
    }
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
      
      // Convert to our UTXO format and fetch scripts
      const utxos: UTXO[] = []
      for (const wocUtxo of wocUtxos) {
        try {
          const script = await getTxOutScript(wocUtxo.tx_hash, wocUtxo.tx_pos)
          utxos.push({
            txid: wocUtxo.tx_hash,
            vout: wocUtxo.tx_pos,
            amount: wocUtxo.value,
            script,
          })
        } catch (err) {
          console.error(`Failed to fetch script for ${wocUtxo.tx_hash}:${wocUtxo.tx_pos}`, err)
        }
      }

      // Update local UTXO cache
      this.syncUtxos(walletId, utxos)
      
      return utxos
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
    db.prepare('UPDATE utxos SET spent = 1, spentAt = datetime("now") WHERE walletId = ? AND spent = 0').run(walletId)

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
