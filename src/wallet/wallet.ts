import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { getDb } from '../registry/db'
import type { AgentWallet } from '../types'

/**
 * BSV Wallet Manager
 * 
 * MVP: Uses simplified key generation.
 * TODO: Integrate @bsv/sdk for real BSV key pairs and transaction signing.
 * For now we generate deterministic-looking keys to build the full flow,
 * then swap in real BSV crypto before mainnet.
 */
export class WalletManager {

  // Create a new agent wallet
  create(): AgentWallet & { privateKey: string } {
    const db = getDb()
    const id = uuid()

    // MVP: Generate key pair (placeholder - will use @bsv/sdk)
    const keyPair = this.generateKeyPair()

    db.prepare(`
      INSERT INTO wallets (id, publicKey, address, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(id, keyPair.publicKey, keyPair.address, new Date().toISOString())

    return {
      id,
      publicKey: keyPair.publicKey,
      address: keyPair.address,
      createdAt: new Date().toISOString(),
      privateKey: keyPair.privateKey, // Only returned on creation!
    }
  }

  // Get wallet by ID
  getById(id: string): AgentWallet | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM wallets WHERE id = ?').get(id) as any
    return row || null
  }

  // Get wallet by address
  getByAddress(address: string): AgentWallet | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM wallets WHERE address = ?').get(address) as any
    return row || null
  }

  // Get balance (MVP: tracked internally, TODO: query BSV network)
  async getBalance(walletId: string): Promise<number> {
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

  private generateKeyPair() {
    // MVP placeholder - generates fake but consistent keys
    // TODO: Replace with @bsv/sdk PrivateKey.fromRandom()
    const privateKeyBytes = crypto.randomBytes(32)
    const privateKey = privateKeyBytes.toString('hex')
    const publicKey = crypto.createHash('sha256').update(privateKeyBytes).digest('hex')
    const address = '1' + crypto.createHash('ripemd160').update(Buffer.from(publicKey, 'hex')).digest('hex').slice(0, 33)

    return { privateKey, publicKey, address }
  }
}
