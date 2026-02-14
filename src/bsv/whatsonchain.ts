/**
 * WhatsOnChain API Client
 * 
 * Provides methods to interact with the BSV blockchain via WhatsOnChain API.
 * Free tier: rate limited but sufficient for MVP.
 */

import { config } from '../config'

const BASE_URL = config.whatsOnChainBase

export interface WOCBalance {
  confirmed: number
  unconfirmed: number
}

export interface WOCUTXO {
  tx_hash: string
  tx_pos: number
  value: number
  height: number
}

export interface WOCTxHistory {
  tx_hash: string
  height: number
  time?: number
}

/**
 * Get balance for an address
 */
export async function getBalance(address: string): Promise<WOCBalance> {
  const response = await fetch(`${BASE_URL}/address/${address}/balance`)
  if (!response.ok) {
    throw new Error(`WhatsOnChain API error: ${response.statusText}`)
  }
  const data = await response.json() as any
  return {
    confirmed: data.confirmed || 0,
    unconfirmed: data.unconfirmed || 0,
  }
}

/**
 * Get UTXOs for an address
 */
export async function getUtxos(address: string): Promise<WOCUTXO[]> {
  const response = await fetch(`${BASE_URL}/address/${address}/unspent`)
  if (!response.ok) {
    if (response.status === 404) {
      return [] // No UTXOs
    }
    throw new Error(`WhatsOnChain API error: ${response.statusText}`)
  }
  const data = await response.json() as WOCUTXO[]
  return data
}

/**
 * Get transaction history for an address
 */
export async function getTxHistory(address: string): Promise<WOCTxHistory[]> {
  const response = await fetch(`${BASE_URL}/address/${address}/history`)
  if (!response.ok) {
    if (response.status === 404) {
      return [] // No history
    }
    throw new Error(`WhatsOnChain API error: ${response.statusText}`)
  }
  const data = await response.json() as WOCTxHistory[]
  return data
}

/**
 * Get transaction details
 */
export async function getTxDetails(txid: string): Promise<any> {
  const response = await fetch(`${BASE_URL}/tx/${txid}`)
  if (!response.ok) {
    throw new Error(`WhatsOnChain API error: ${response.statusText}`)
  }
  return response.json()
}

/**
 * Broadcast a raw transaction
 */
export async function broadcastTx(txHex: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/tx/raw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ txhex: txHex }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Transaction broadcast failed: ${error}`)
  }

  // WhatsOnChain returns the txid on success
  const txid = await response.text()
  return txid.replace(/"/g, '') // Remove quotes if present
}

/**
 * Get script for a transaction output
 */
export async function getTxOutScript(txid: string, vout: number): Promise<string> {
  const tx = await getTxDetails(txid)
  if (!tx.vout || !tx.vout[vout]) {
    throw new Error(`Output ${vout} not found in transaction ${txid}`)
  }
  return tx.vout[vout].scriptPubKey.hex
}
