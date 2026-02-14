/**
 * Yours Wallet Provider
 */

import { v4 as uuid } from 'uuid'
import { getDb } from '../../registry/db'
import { config } from '../../config'
import { getBalance as getOnChainBalance } from '../../bsv/whatsonchain'
import type {
  WalletProvider,
  WalletConnection,
  SignedTransaction,
  TransactionRequest,
  YoursConnectParams,
} from './types'

export class YoursWalletProvider implements WalletProvider {
  type = 'yours' as const

  async connect(params?: YoursConnectParams): Promise<WalletConnection> {
    if (!params?.address || !params?.publicKey) {
      throw new Error('Yours wallet address and public key required')
    }

    const db = getDb()
    const { address, publicKey } = params

    const existing = db.prepare('SELECT id FROM wallets WHERE address = ?').get(address) as any
    
    if (existing) {
      this.updateProviderMetadata(existing.id, { publicKey })
      
      return {
        walletId: existing.id,
        address,
        publicKey,
        displayName: 'Yours Wallet',
        providerType: 'yours',
      }
    }

    const id = uuid()
    const createdAt = new Date().toISOString()

    db.prepare(`
      INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, publicKey, address, '', createdAt)

    this.storeProviderMetadata(id, { publicKey })

    return {
      walletId: id,
      address,
      publicKey,
      displayName: 'Yours Wallet',
      providerType: 'yours',
    }
  }

  async getBalance(walletId: string): Promise<number> {
    const db = getDb()
    const wallet = db.prepare('SELECT address FROM wallets WHERE id = ?').get(walletId) as any
    if (!wallet) throw new Error('Wallet not found')

    if (config.demoMode) {
      return 100000
    }

    try {
      const balance = await getOnChainBalance(wallet.address)
      return balance.confirmed + balance.unconfirmed
    } catch (error: any) {
      throw new Error(`Failed to fetch balance: ${error.message}`)
    }
  }

  async signTransaction(_walletId: string, _txReq: TransactionRequest): Promise<SignedTransaction> {
    throw new Error(
      'Yours wallet signing must happen client-side. ' +
      'Use prepareTransaction() to get transaction data, ' +
      'then sign via browser extension and submit with submitSignedTransaction().'
    )
  }

  prepareTransaction(walletId: string, txReq: TransactionRequest): TransactionRequest {
    const db = getDb()
    const wallet = db.prepare('SELECT address FROM wallets WHERE id = ?').get(walletId) as any
    if (!wallet) throw new Error('Wallet not found')

    return txReq
  }

  async submitSignedTransaction(walletId: string, signedTx: SignedTransaction): Promise<SignedTransaction> {
    const db = getDb()
    const wallet = db.prepare('SELECT address FROM wallets WHERE id = ?').get(walletId) as any
    if (!wallet) throw new Error('Wallet not found')

    this.updateLastUsed(walletId)

    return signedTx
  }

  async getAddress(walletId: string): Promise<string> {
    const db = getDb()
    const row = db.prepare('SELECT address FROM wallets WHERE id = ?').get(walletId) as any
    if (!row) throw new Error('Wallet not found')
    return row.address
  }

  async disconnect(walletId: string): Promise<void> {
    const db = getDb()
    db.prepare('DELETE FROM wallet_providers WHERE walletId = ?').run(walletId)
  }

  private storeProviderMetadata(walletId: string, data: any): void {
    const db = getDb()
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS wallet_providers (
        walletId TEXT PRIMARY KEY,
        providerType TEXT NOT NULL,
        providerData TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastUsed TEXT
      )
    `)

    db.prepare(`
      INSERT OR REPLACE INTO wallet_providers (walletId, providerType, providerData, createdAt, lastUsed)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `).run(walletId, 'yours', JSON.stringify(data))
  }

  private updateProviderMetadata(walletId: string, data: any): void {
    const db = getDb()
    
    db.prepare(`
      UPDATE wallet_providers 
      SET providerData = ?, lastUsed = datetime('now')
      WHERE walletId = ?
    `).run(JSON.stringify(data), walletId)
  }

  private updateLastUsed(walletId: string): void {
    const db = getDb()
    db.prepare(`UPDATE wallet_providers SET lastUsed = datetime('now') WHERE walletId = ?`).run(walletId)
  }
}
