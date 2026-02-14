/**
 * Wallet Provider Types
 */

export type WalletProviderType = 'internal' | 'handcash' | 'yours'

export interface WalletConnection {
  walletId: string
  address: string
  publicKey?: string
  paymail?: string
  displayName?: string
  providerType: WalletProviderType
}

export interface SignedTransaction {
  txHex: string
  txId: string
}

export interface TransactionRequest {
  recipients: Array<{
    address: string
    amount: number
  }>
  changeAddress?: string
  data?: string[]
}

export interface WalletProvider {
  type: WalletProviderType
  connect(params?: any): Promise<WalletConnection>
  getBalance(walletId: string): Promise<number>
  signTransaction(walletId: string, tx: TransactionRequest): Promise<SignedTransaction>
  getAddress(walletId: string): Promise<string>
  disconnect(walletId: string): Promise<void>
}

export interface HandCashConnectParams {
  authToken: string
}

export interface YoursConnectParams {
  address: string
  publicKey: string
}

export interface InternalConnectParams {
  privateKeyWif?: string
}

export interface WalletProviderMetadata {
  walletId: string
  providerType: WalletProviderType
  providerData: string
  createdAt: string
  lastUsed?: string
}
