/**
 * BSV Crypto Utilities
 * 
 * Handles key generation, encryption, address derivation, and transaction building.
 */

import { PrivateKey, PublicKey, P2PKH, Transaction, ARC, Script } from '@bsv/sdk'
import crypto from 'crypto'
import { config } from '../config'

/**
 * Generate a new BSV private key
 */
export function generatePrivateKey(): PrivateKey {
  return PrivateKey.fromRandom()
}

/**
 * Derive P2PKH address from private key
 */
export function deriveAddress(privateKey: PrivateKey): string {
  const publicKey = privateKey.toPublicKey()
  return config.network === 'testnet' 
    ? publicKey.toAddress('testnet') 
    : publicKey.toAddress()
}

/**
 * Get public key hex from private key
 */
export function getPublicKeyHex(privateKey: PrivateKey): string {
  return privateKey.toPublicKey().toString()
}

/**
 * Encrypt private key for storage
 */
export function encryptPrivateKey(privateKeyWif: string): string {
  const algorithm = config.encryption.algorithm
  const key = crypto.scryptSync(config.encryption.masterKey, 'salt', 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(algorithm, key, iv)
  
  let encrypted = cipher.update(privateKeyWif, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  
  const authTag = (cipher as any).getAuthTag().toString('hex')
  
  // Format: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

/**
 * Decrypt private key from storage
 */
export function decryptPrivateKey(encryptedData: string): string {
  const algorithm = config.encryption.algorithm
  const key = crypto.scryptSync(config.encryption.masterKey, 'salt', 32)
  
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':')
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv)
  ;(decipher as any).setAuthTag(authTag)
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  
  return decrypted
}

/**
 * Convert private key WIF to PrivateKey object
 */
export function privateKeyFromWif(wif: string): PrivateKey {
  return PrivateKey.fromWif(wif)
}

/**
 * UTXO type for transaction building
 */
export interface UTXO {
  txid: string
  vout: number
  amount: number // satoshis
  script: string // hex
}

/**
 * Build a BSV transaction
 * 
 * @param utxos - Input UTXOs
 * @param outputs - Output addresses and amounts
 * @param changeAddress - Address to send change
 * @param privateKey - Private key for signing
 * @returns Signed transaction hex
 */
export async function buildTransaction(
  utxos: UTXO[],
  outputs: Array<{ address: string; amount: number }>,
  changeAddress: string,
  privateKey: PrivateKey
): Promise<string> {
  console.log('[DEBUG] buildTransaction called with', {
    utxoCount: utxos.length,
    outputCount: outputs.length,
    changeAddress,
  })
  
  const tx = new Transaction()
  console.log('[DEBUG] Transaction object created')

  // Add inputs
  let totalInput = 0
  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i]
    console.log(`[DEBUG] Processing UTXO ${i}:`, { txid: utxo.txid, vout: utxo.vout, amount: utxo.amount })
    
    try {
      const lockingScript = Script.fromHex(utxo.script)
      console.log('[DEBUG] Locking script created from hex')
      
      // Create unlock template - simpler approach
      const unlockTemplate = new P2PKH().unlock(privateKey)
      console.log('[DEBUG] Unlock template created')
      
      tx.addInput({
        sourceTransaction: {
          outputs: [{
            lockingScript,
            satoshis: utxo.amount,
          }],
        } as any,
        sourceTXID: utxo.txid,
        sourceOutputIndex: utxo.vout,
        unlockingScriptTemplate: unlockTemplate,
        sequence: 0xffffffff,
      })
      console.log(`[DEBUG] Input ${i} added successfully`)
      totalInput += utxo.amount
    } catch (error: any) {
      console.error(`[DEBUG] Failed to add input ${i}:`, error.message)
      throw error
    }
  }
  
  console.log('[DEBUG] All inputs added, totalInput:', totalInput)

  // Add outputs
  let totalOutput = 0
  for (const output of outputs) {
    const lockingScript = new P2PKH().lock(output.address)
    tx.addOutput({
      lockingScript,
      satoshis: output.amount,
    })
    totalOutput += output.amount
  }

  // Calculate fee (estimate without serializing)
  // P2PKH input: ~148 bytes, P2PKH output: ~34 bytes, overhead: ~10 bytes
  const estimatedSize = 10 + (148 * utxos.length) + (34 * (outputs.length + 1)) // +1 for potential change
  const fee = Math.max(250, Math.ceil(estimatedSize * config.feePerByte)) // Minimum 250 sats
  console.log('[DEBUG] Estimated fee:', fee, 'sats for estimated size:', estimatedSize, 'bytes')

  // Add change output if needed
  const change = totalInput - totalOutput - fee
  console.log('[DEBUG] Change calculation:', { totalInput, totalOutput, fee, change })
  if (change > 546) { // dust limit
    const lockingScript = new P2PKH().lock(changeAddress)
    tx.addOutput({
      lockingScript,
      satoshis: change,
    })
    console.log('[DEBUG] Added change output:', change, 'sats')
  } else {
    console.log('[DEBUG] No change output (dust or negative):', change)
  }

  // Sign transaction
  try {
    console.log('[DEBUG] Transaction before signing:', {
      inputs: tx.inputs?.length || 0,
      outputs: tx.outputs?.length || 0,
    })
    
    // Sign using the private key
    await tx.sign()
    
    console.log('[DEBUG] Transaction signed successfully')
    console.log('[DEBUG] Checking if inputs have unlockingScripts...')
    for (let i = 0; i < tx.inputs.length; i++) {
      const input = tx.inputs[i]
      console.log(`[DEBUG] Input ${i} unlockingScript:`, input.unlockingScript ? 'present' : 'MISSING')
    }
    
    const txHex = tx.toHex()
    console.log('[DEBUG] Transaction serialized to hex, length:', txHex.length)
    return txHex
  } catch (error: any) {
    console.error('[DEBUG] Transaction signing failed:', error.message)
    console.error('[DEBUG] Stack:', error.stack)
    throw error
  }
}

/**
 * Get transaction ID from hex
 */
export function getTxId(txHex: string): string {
  const tx = Transaction.fromHex(txHex)
  return tx.id('hex') as string
}

/**
 * Verify transaction is valid
 */
export function verifyTransaction(txHex: string): boolean {
  try {
    const tx = Transaction.fromHex(txHex)
    tx.verify()
    return true
  } catch {
    return false
  }
}

/**
 * Get P2PKH locking script hex for an address
 */
export function getScriptForAddress(address: string): string {
  const lockingScript = new P2PKH().lock(address)
  return lockingScript.toHex()
}
