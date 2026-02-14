/**
 * Wallet Provider Manager
 * 
 * Central coordinator for all wallet providers.
 * Handles provider selection, switching, and delegation.
 */

import { getDb } from '../registry/db'
import { InternalWalletProvider } from './providers/internal'
import { HandCashWalletProvider } from './providers/handcash'
import { YoursWalletProvider } from './providers/yours'
import type {
  WalletProvider,
  WalletProviderType,
  WalletConnection,
  SignedTransaction,
  TransactionRequest,
  WalletProviderMetadata,
} from './providers/types'

export class ProviderManager {
  private providers: Map<WalletProviderType, WalletProvider>

  constructor() {
    this.providers = new Map<WalletProviderType, WalletProvider>()
    this.providers.set('internal', new InternalWalletProvider())
    this.providers.set('handcash', new HandCashWalletProvider())
    this.providers.set('yours', new YoursWalletProvider())
  }

  getProvider(type: WalletProviderType): WalletProvider {
    const provider = this.providers.get(type)
    if (!provider) {
      throw new Error(`Unknown provider type: ${type}`)
    }
    return provider
  }

  getWalletProvider(walletId: string): WalletProvider {
    const metadata = this.getProviderMetadata(walletId)
    if (!metadata) {
      return this.getProvider('internal')
    }
    return this.getProvider(metadata.providerType)
  }

  getProviderMetadata(walletId: string): WalletProviderMetadata | null {
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

    const row = db.prepare('SELECT * FROM wallet_providers WHERE walletId = ?').get(walletId) as any
    return row || null
  }

  async connect(type: WalletProviderType, params?: any): Promise<WalletConnection> {
    const provider = this.getProvider(type)
    return provider.connect(params)
  }

  async getBalance(walletId: string): Promise<number> {
    const provider = this.getWalletProvider(walletId)
    return provider.getBalance(walletId)
  }

  async signTransaction(walletId: string, txReq: TransactionRequest): Promise<SignedTransaction> {
    const provider = this.getWalletProvider(walletId)
    return provider.signTransaction(walletId, txReq)
  }

  async getAddress(walletId: string): Promise<string> {
    const provider = this.getWalletProvider(walletId)
    return provider.getAddress(walletId)
  }

  async disconnect(walletId: string): Promise<void> {
    const provider = this.getWalletProvider(walletId)
    await provider.disconnect(walletId)
  }

  async getWalletInfo(walletId: string): Promise<{
    wallet: any
    provider: WalletProviderMetadata | null
    balance: number
  }> {
    const db = getDb()
    const wallet = db.prepare('SELECT id, publicKey, address, createdAt FROM wallets WHERE id = ?').get(walletId) as any
    
    if (!wallet) {
      throw new Error('Wallet not found')
    }

    const provider = this.getProviderMetadata(walletId)
    const balance = await this.getBalance(walletId)

    return {
      wallet,
      provider,
      balance,
    }
  }

  listProviders(): Array<{ type: WalletProviderType; name: string; description: string }> {
    return [
      {
        type: 'internal',
        name: 'Internal Wallet',
        description: 'Private key stored on server (encrypted). For development only.',
      },
      {
        type: 'handcash',
        name: 'HandCash',
        description: 'Connect your HandCash wallet. Private keys never leave HandCash.',
      },
      {
        type: 'yours',
        name: 'Yours Wallet',
        description: 'Use Yours Wallet browser extension. Sign transactions locally.',
      },
    ]
  }

  async switchProvider(walletId: string, newType: WalletProviderType, params?: any): Promise<WalletConnection> {
    await this.disconnect(walletId)
    const provider = this.getProvider(newType)
    return provider.connect(params)
  }
}

let providerManager: ProviderManager | null = null

export function getProviderManager(): ProviderManager {
  if (!providerManager) {
    providerManager = new ProviderManager()
  }
  return providerManager
}
