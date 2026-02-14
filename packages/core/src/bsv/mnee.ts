/**
 * MNEE Token Operations (BSV-21 Stablecoin on 1Sat Ordinals)
 * 
 * MNEE is a USD-backed stablecoin on BSV using the 1Sat Ordinals protocol (BSV-21).
 * - 1 MNEE token = $1.00 USD
 * - Amounts in AgentsPay are stored as cents (1 cent = $0.01)
 * 
 * Demo Mode: Uses internal ledger
 * Production: TODO - Implement real BSV-21 token transfers
 */

import { config } from '../config'
import { getDb } from '../registry/db'

export interface MneeUtxo {
  txid: string
  vout: number
  satoshis: number
  tokens: number
  script: string
  tokenId: string
}

export interface MneeTransferResult {
  txid: string
  rawTx?: string
  fee: number
}

export interface MneeBalance {
  address: string
  balance: number
  utxos: MneeUtxo[]
}

export class MneeTokenManager {
  async getBalance(address: string): Promise<number> {
    if (config.demoMode) {
      return this.getDemoBalance(address)
    }
    // Production MNEE not implemented yet — return 0
    return 0
  }

  async getUtxos(address: string): Promise<MneeUtxo[]> {
    if (config.demoMode) {
      return []
    }
    // Production MNEE not implemented yet — return empty
    return []
  }

  async transfer(
    fromAddress: string,
    toAddress: string,
    amount: number,
    privateKeyWif: string
  ): Promise<MneeTransferResult> {
    if (amount <= 0 || !Number.isInteger(amount)) {
      throw new Error('Invalid MNEE amount')
    }

    if (config.demoMode) {
      return this.demoTransfer(fromAddress, toAddress, amount)
    }

    // Production MNEE transfers not implemented yet
    throw new Error('MNEE production transfers not implemented yet. Use demo mode or BSV.')
  }

  private getDemoBalance(address: string): number {
    const db = getDb()
    const row = db
      .prepare('SELECT SUM(amount) as balance FROM mnee_ledger WHERE address = ?')
      .get(address) as any
    return row?.balance || 0
  }

  private demoTransfer(from: string, to: string, amount: number): MneeTransferResult {
    const db = getDb()
    const balance = this.getDemoBalance(from)
    if (balance < amount) {
      throw new Error(`Insufficient MNEE balance. Have ${balance} cents, need ${amount} cents`)
    }

    const txid = `mnee-demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    db.prepare('INSERT INTO mnee_ledger (address, amount, txid, createdAt) VALUES (?, ?, ?, ?)').run(
      from, -amount, txid, new Date().toISOString()
    )
    db.prepare('INSERT INTO mnee_ledger (address, amount, txid, createdAt) VALUES (?, ?, ?, ?)').run(
      to, amount, txid, new Date().toISOString()
    )

    return { txid, fee: 0 }
  }

  async fundDemo(address: string, amount: number): Promise<void> {
    if (!config.demoMode) {
      throw new Error('fundDemo only available in demo mode')
    }

    const db = getDb()
    const txid = `mnee-fund-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    db.prepare('INSERT INTO mnee_ledger (address, amount, txid, createdAt) VALUES (?, ?, ?, ?)').run(
      address, amount, txid, new Date().toISOString()
    )
  }
}

export const mneeTokens = new MneeTokenManager()
