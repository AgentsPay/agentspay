/**
 * HandCash Connect Provider
 */

import { v4 as uuid } from 'uuid'
import { getDb } from '../../registry/db'
import { config } from '../../config'
import type {
  WalletProvider,
  WalletConnection,
  SignedTransaction,
  TransactionRequest,
  HandCashConnectParams,
} from './types'

let HandCashConnect: any = null
try {
  HandCashConnect = require('@handcash/handcash-connect').HandCashConnect
} catch {
  console.warn('⚠️  HandCash Connect SDK not installed. HandCash provider will use mock mode.')
}

export class HandCashWalletProvider implements WalletProvider {
  type = 'handcash' as const
  private appId: string
  private appSecret: string
  private redirectUrl: string

  constructor() {
    this.appId = process.env.HANDCASH_APP_ID || 'demo-app-id'
    this.appSecret = process.env.HANDCASH_APP_SECRET || 'demo-app-secret'
    this.redirectUrl = process.env.HANDCASH_REDIRECT_URL || 'http://localhost:3100/api/wallets/connect/handcash/callback'
  }

  getAuthorizationUrl(): string {
    if (!HandCashConnect || config.demoMode) {
      return 'https://demo-handcash-auth-url.com'
    }

    const handCashConnect = new HandCashConnect({
      appId: this.appId,
      appSecret: this.appSecret,
    })

    return handCashConnect.getRedirectionUrl()
  }

  async connect(params?: HandCashConnectParams): Promise<WalletConnection> {
    if (!params?.authToken) {
      throw new Error('HandCash auth token required')
    }

    const db = getDb()
    const id = uuid()

    if (!HandCashConnect || config.demoMode) {
      const mockConnection: WalletConnection = {
        walletId: id,
        address: '1MockHandCashAddress' + Math.random().toString(36).slice(2, 8),
        paymail: 'demo@handcash.io',
        displayName: 'Demo HandCash User',
        providerType: 'handcash',
      }

      this.storeProviderMetadata(id, {
        authToken: params.authToken,
        paymail: mockConnection.paymail,
        displayName: mockConnection.displayName,
      })

      db.prepare(`
        INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, '', mockConnection.paymail, '', new Date().toISOString())

      return mockConnection
    }

    try {
      const handCashConnect = new HandCashConnect({
        appId: this.appId,
        appSecret: this.appSecret,
      })

      const account = handCashConnect.getAccountFromAuthToken(params.authToken)
      const profile = await account.profile.getCurrentProfile()

      const existing = db.prepare('SELECT id FROM wallet_providers WHERE providerData LIKE ?')
        .get(`%"paymail":"${profile.paymail}"%`) as any

      if (existing) {
        this.updateProviderMetadata(existing.id, {
          authToken: params.authToken,
          paymail: profile.paymail,
          displayName: profile.displayName,
        })

        return {
          walletId: existing.id,
          address: profile.paymail,
          paymail: profile.paymail,
          displayName: profile.displayName,
          providerType: 'handcash',
        }
      }

      const createdAt = new Date().toISOString()
      db.prepare(`
        INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, '', profile.paymail, '', createdAt)

      this.storeProviderMetadata(id, {
        authToken: params.authToken,
        paymail: profile.paymail,
        displayName: profile.displayName,
        handle: profile.handle,
      })

      return {
        walletId: id,
        address: profile.paymail,
        paymail: profile.paymail,
        displayName: profile.displayName,
        providerType: 'handcash',
      }
    } catch (error: any) {
      throw new Error(`HandCash connection failed: ${error.message}`)
    }
  }

  async getBalance(walletId: string): Promise<number> {
    if (!HandCashConnect || config.demoMode) {
      return 100000
    }

    const metadata = this.getProviderMetadata(walletId)
    if (!metadata) throw new Error('HandCash wallet not found')

    const data = JSON.parse(metadata.providerData)
    
    try {
      const handCashConnect = new HandCashConnect({
        appId: this.appId,
        appSecret: this.appSecret,
      })

      const account = handCashConnect.getAccountFromAuthToken(data.authToken)
      const balanceBsv = await account.wallet.getSpendableBalance('BSV')
      
      return Math.floor(balanceBsv * 100000000)
    } catch (error: any) {
      throw new Error(`Failed to fetch HandCash balance: ${error.message}`)
    }
  }

  async signTransaction(walletId: string, txReq: TransactionRequest): Promise<SignedTransaction> {
    if (!HandCashConnect || config.demoMode) {
      return {
        txHex: '0100000001...' + Math.random().toString(36),
        txId: 'mock-handcash-tx-' + uuid(),
      }
    }

    const metadata = this.getProviderMetadata(walletId)
    if (!metadata) throw new Error('HandCash wallet not found')

    const data = JSON.parse(metadata.providerData)

    try {
      const handCashConnect = new HandCashConnect({
        appId: this.appId,
        appSecret: this.appSecret,
      })

      const account = handCashConnect.getAccountFromAuthToken(data.authToken)

      const payments = txReq.recipients.map(r => ({
        destination: r.address,
        currencyCode: 'SAT',
        sendAmount: r.amount,
      }))

      const attachment = txReq.data && txReq.data.length > 0 
        ? { data: txReq.data.join(' ') }
        : undefined

      const paymentResult = await account.wallet.pay({
        payments,
        attachment,
      })

      this.updateLastUsed(walletId)

      return {
        txHex: paymentResult.rawTransactionHex || '',
        txId: paymentResult.transactionId,
      }
    } catch (error: any) {
      throw new Error(`HandCash payment failed: ${error.message}`)
    }
  }

  async getAddress(walletId: string): Promise<string> {
    const metadata = this.getProviderMetadata(walletId)
    if (!metadata) throw new Error('HandCash wallet not found')

    const data = JSON.parse(metadata.providerData)
    return data.paymail
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
    `).run(walletId, 'handcash', JSON.stringify(data))
  }

  private updateProviderMetadata(walletId: string, data: any): void {
    const db = getDb()
    
    db.prepare(`
      UPDATE wallet_providers 
      SET providerData = ?, lastUsed = datetime('now')
      WHERE walletId = ?
    `).run(JSON.stringify(data), walletId)
  }

  private getProviderMetadata(walletId: string): any {
    const db = getDb()
    return db.prepare('SELECT * FROM wallet_providers WHERE walletId = ? AND providerType = ?')
      .get(walletId, 'handcash') as any
  }

  private updateLastUsed(walletId: string): void {
    const db = getDb()
    db.prepare(`UPDATE wallet_providers SET lastUsed = datetime('now') WHERE walletId = ?`).run(walletId)
  }
}
