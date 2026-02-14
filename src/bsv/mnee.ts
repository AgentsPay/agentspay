/**
 * MNEE Token Operations (BSV-21 Stablecoin on 1Sat Ordinals)
 * 
 * MNEE is a USD-backed stablecoin on BSV using the 1Sat Ordinals protocol (BSV-21).
 * - 1 MNEE token = $1.00 USD
 * - Amounts in AgentsPay are stored as cents (1 cent = $0.01)
 * 
 * Technical Notes:
 * - BSV-21 tokens are transferred via BSV transactions with special ordinal metadata
 * - Each token transfer creates a BSV transaction with token overlay data
 * - Token balances are tracked via UTXO set (similar to Bitcoin)
 * 
 * Integration Options:
 * 1. js-1sat-ord: General 1Sat Ordinals library for BSV-21 tokens
 * 2. mnee-fireblocks-sdk: MNEE-specific SDK with Fireblocks signing
 * 3. Direct BSV SDK + API: Build transactions manually using 1Sat Ordinals protocol
 * 
 * Demo Mode:
 * - Uses internal ledger (similar to BSV demo mode)
 * - No on-chain transactions
 * - Balances tracked in database
 * 
 * Production:
 * - Implement real BSV-21 token transfers using js-1sat-ord or MNEE SDK
 * - Query token balances from 1Sat API or blockchain indexer
 * - Broadcast token transactions to BSV network
 */

import { config } from '../config'
import { getDb } from '../registry/db'

export interface MneeUtxo {
  txid: string
  vout: number
  satoshis: number // BSV satoshis in the UTXO
  tokens: number // MNEE tokens in cents (1 cent = $0.01)
  script: string // base64 encoded
  tokenId: string // BSV-21 token ID (outpoint format: txid_vout)
}

export interface MneeTransferResult {
  txid: string
  rawTx?: string
  fee: number // BSV satoshis used for transaction fee
}

export interface MneeBalance {
  address: string
  balance: number // MNEE tokens in cents
  utxos: MneeUtxo[]
}

/**
 * MNEE Token Manager
 * 
 * For demo mode: Uses internal ledger
 * For production: Implement real BSV-21 token operations
 */
export class MneeTokenManager {
  /**
   * Get MNEE token balance for an address
   * 
   * Demo: Returns balance from internal ledger
   * Production: Query 1Sat API or blockchain indexer for BSV-21 token UTXOs
   */
  async getBalance(address: string): Promise<number> {
    if (config.demoMode) {
      return this.getDemoBalance(address)
    }

    // TODO: Production implementation
    // - Fetch BSV-21 token UTXOs from 1Sat Ordinals API
    // - Filter by MNEE token ID
    // - Sum token amounts
    // Example using js-1sat-ord:
    // import { fetchTokenUtxos, TokenType } from 'js-1sat-ord'
    // const MNEE_TOKEN_ID = 'mnee_token_id_here'
    // const tokenUtxos = await fetchTokenUtxos(TokenType.BSV21, MNEE_TOKEN_ID, address)
    // return tokenUtxos.reduce((sum, utxo) => sum + utxo.tokens, 0)

    throw new Error('MNEE production mode not implemented. Set DEMO_MODE=true for testing.')
  }

  /**
   * Get MNEE UTXOs for an address
   * 
   * Demo: Returns empty (not needed for demo ledger)
   * Production: Fetch actual BSV-21 token UTXOs
   */
  async getUtxos(address: string): Promise<MneeUtxo[]> {
    if (config.demoMode) {
      return [] // Demo mode uses internal ledger, no UTXOs needed
    }

    // TODO: Production implementation
    // - Fetch BSV-21 token UTXOs from 1Sat Ordinals API
    // Example using js-1sat-ord:
    // import { fetchTokenUtxos, TokenType } from 'js-1sat-ord'
    // const MNEE_TOKEN_ID = 'mnee_token_id_here'
    // const utxos = await fetchTokenUtxos(TokenType.BSV21, MNEE_TOKEN_ID, address)
    // return utxos.map(u => ({
    //   txid: u.txid,
    //   vout: u.vout,
    //   satoshis: u.satoshis,
    //   tokens: u.tokens,
    //   script: u.script,
    //   tokenId: MNEE_TOKEN_ID
    // }))

    throw new Error('MNEE production mode not implemented. Set DEMO_MODE=true for testing.')
  }

  /**
   * Transfer MNEE tokens
   * 
   * Demo: Updates internal ledger
   * Production: Build and broadcast BSV-21 token transfer transaction
   */
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

    // TODO: Production implementation
    // - Fetch sender's MNEE UTXOs
    // - Build BSV-21 token transfer transaction using js-1sat-ord
    // - Sign and broadcast
    // Example using js-1sat-ord:
    // import { transferOrdToken, TokenType, PrivateKey } from 'js-1sat-ord'
    // import { fetchTokenUtxos, fetchPayUtxos } from 'js-1sat-ord'
    // 
    // const MNEE_TOKEN_ID = 'mnee_token_id_here'
    // const paymentPk = PrivateKey.fromWif(privateKeyWif)
    // const ordPk = PrivateKey.fromWif(privateKeyWif) // Same key or separate ordinals key
    // 
    // const paymentUtxos = await fetchPayUtxos(fromAddress)
    // const tokenUtxos = await fetchTokenUtxos(TokenType.BSV21, MNEE_TOKEN_ID, fromAddress)
    // 
    // const config = {
    //   protocol: TokenType.BSV21,
    //   tokenID: MNEE_TOKEN_ID,
    //   utxos: paymentUtxos,
    //   inputTokens: tokenUtxos,
    //   distributions: [{ address: toAddress, tokens: amount / 100 }], // Convert cents to tokens
    //   paymentPk,
    //   ordPk,
    //   changeAddress: fromAddress
    // }
    // 
    // const result = await transferOrdToken(config)
    // const { txid } = await result.tx.broadcast()
    // 
    // return { txid, rawTx: result.tx.toHex(), fee: result.tx.fee || 0 }

    throw new Error('MNEE production mode not implemented. Set DEMO_MODE=true for testing.')
  }

  /**
   * Demo mode: Get balance from internal ledger
   */
  private getDemoBalance(address: string): number {
    const db = getDb()
    const row = db
      .prepare('SELECT SUM(amount) as balance FROM mnee_ledger WHERE address = ?')
      .get(address) as any
    return row?.balance || 0
  }

  /**
   * Demo mode: Transfer via internal ledger
   */
  private demoTransfer(from: string, to: string, amount: number): MneeTransferResult {
    const db = getDb()

    // Check sender balance
    const balance = this.getDemoBalance(from)
    if (balance < amount) {
      throw new Error(`Insufficient MNEE balance. Have ${balance} cents, need ${amount} cents`)
    }

    const txid = `mnee-demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // Debit sender
    db.prepare('INSERT INTO mnee_ledger (address, amount, txid, createdAt) VALUES (?, ?, ?, ?)').run(
      from,
      -amount,
      txid,
      new Date().toISOString()
    )

    // Credit receiver
    db.prepare('INSERT INTO mnee_ledger (address, amount, txid, createdAt) VALUES (?, ?, ?, ?)').run(
      to,
      amount,
      txid,
      new Date().toISOString()
    )

    return { txid, fee: 0 }
  }

  /**
   * Demo mode: Fund an address with MNEE tokens for testing
   */
  async fundDemo(address: string, amount: number): Promise<void> {
    if (!config.demoMode) {
      throw new Error('fundDemo only available in demo mode')
    }

    const db = getDb()
    const txid = `mnee-fund-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    db.prepare('INSERT INTO mnee_ledger (address, amount, txid, createdAt) VALUES (?, ?, ?, ?)').run(
      address,
      amount,
      txid,
      new Date().toISOString()
    )
  }
}

export const mneeTokens = new MneeTokenManager()
