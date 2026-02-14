/**
 * Internal Wallet Provider
 */

import { v4 as uuid } from 'uuid'
import { getDb } from '../../registry/db'
import {
  generatePrivateKey,
  deriveAddress,
  getPublicKeyHex,
  encryptPrivateKey,
  decryptPrivateKey,
  privateKeyFromWif,
} from '../../bsv/crypto'
import { getBalance as getOnChainBalance } from '../../bsv/whatsonchain'
import { config } from '../../config'
import type {
  WalletProvider,
  WalletConnection,
  SignedTransaction,
  TransactionRequest,
  InternalConnectParams,
} from './types'
import { Transaction, PrivateKey, P2PKH, LockingScript } from '@bsv/sdk'

export class InternalWalletProvider implements WalletProvider {
  type = 'internal' as const

  async connect(params?: InternalConnectParams): Promise<WalletConnection> {
    const db = getDb()
    const id = uuid()

    let privKey: PrivateKey
    let privateKeyWif: string

    if (params?.privateKeyWif) {
      privateKeyWif = params.privateKeyWif
      privKey = privateKeyFromWif(privateKeyWif)
    } else {
      privKey = generatePrivateKey()
      privateKeyWif = privKey.toWif()
    }

    const publicKey = getPublicKeyHex(privKey)
    const address = deriveAddress(privKey)

    const existing = db.prepare('SELECT id, address, publicKey FROM wallets WHERE address = ?').get(address) as any
    if (existing) {
      return {
        walletId: existing.id,
        address: existing.address,
        publicKey: existing.publicKey,
        providerType: 'internal',
      }
    }

    const encryptedPrivKey = encryptPrivateKey(privateKeyWif)
    const createdAt = new Date().toISOString()

    db.prepare(`
      INSERT INTO wallets (id, publicKey, address, privateKey, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, publicKey, address, encryptedPrivKey, createdAt)

    this.storeProviderMetadata(id, {})

    return { walletId: id, address, publicKey, providerType: 'internal' }
  }

  async getBalance(walletId: string): Promise<number> {
    const db = getDb()
    const wallet = db.prepare('SELECT address FROM wallets WHERE id = ?').get(walletId) as any
    if (!wallet) throw new Error('Wallet not found')

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

  async signTransaction(walletId: string, txReq: TransactionRequest): Promise<SignedTransaction> {
    const db = getDb()
    
    const row = db.prepare('SELECT privateKey, address FROM wallets WHERE id = ?').get(walletId) as any
    if (!row || !row.privateKey) throw new Error('Wallet not found or no private key')

    const privateKeyWif = decryptPrivateKey(row.privateKey)
    const privKey = privateKeyFromWif(privateKeyWif)

    const { getUtxos } = await import('../../bsv/whatsonchain')
    const utxos = await getUtxos(row.address)

    if (utxos.length === 0) {
      throw new Error('No UTXOs available')
    }

    const tx = new Transaction()
    const totalOut = txReq.recipients.reduce((sum, r) => sum + r.amount, 0)
    const estimatedFee = 200

    let totalIn = 0
    for (const utxo of utxos) {
      if (totalIn >= totalOut + estimatedFee) break
      
      tx.addInput({
        sourceTXID: utxo.tx_hash,
        sourceOutputIndex: utxo.tx_pos,
        unlockingScriptTemplate: new P2PKH().unlock(privKey),
        sequence: 0xffffffff,
      })
      
      totalIn += utxo.value
    }

    if (totalIn < totalOut + estimatedFee) {
      throw new Error(`Insufficient funds: need ${totalOut + estimatedFee}, have ${totalIn}`)
    }

    for (const recipient of txReq.recipients) {
      tx.addOutput({
        lockingScript: new P2PKH().lock(recipient.address),
        change: false,
        satoshis: recipient.amount,
      })
    }

    if (txReq.data && txReq.data.length > 0) {
      const opReturnParts = ['OP_FALSE', 'OP_RETURN', ...txReq.data.map(d => `0x${Buffer.from(d).toString('hex')}`)]
      const opReturnScript = LockingScript.fromASM(opReturnParts.join(' '))
      tx.addOutput({
        lockingScript: opReturnScript,
        change: false,
        satoshis: 0,
      })
    }

    const changeAddress = txReq.changeAddress || row.address
    const actualFee = Math.ceil(tx.toBinary().length * config.feePerByte)
    const changeAmount = totalIn - totalOut - actualFee

    if (changeAmount > 546) {
      tx.addOutput({
        lockingScript: new P2PKH().lock(changeAddress),
        change: true,
        satoshis: changeAmount,
      })
    }

    await tx.fee()
    await tx.sign()

    const txHex = tx.toHex()
    const txId = tx.id('hex') as string

    return { txHex, txId }
  }

  async getAddress(walletId: string): Promise<string> {
    const db = getDb()
    const row = db.prepare('SELECT address FROM wallets WHERE id = ?').get(walletId) as any
    if (!row) throw new Error('Wallet not found')
    return row.address
  }

  async disconnect(_walletId: string): Promise<void> {
    // Nothing to disconnect
  }

  private getInternalBalance(walletId: string): number {
    const db = getDb()

    let deposits = 0
    try {
      const dep = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE walletId = ?`).get(walletId) as any
      deposits = dep?.total || 0
    } catch {
      /* table may not exist yet */
    }

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
    `).run(walletId, 'internal', JSON.stringify(data))
  }
}
