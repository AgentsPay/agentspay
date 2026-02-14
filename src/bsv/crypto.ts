/**
 * BSV Crypto Utilities
 * 
 * Handles key generation, encryption, address derivation, and transaction building.
 */

import { PrivateKey, PublicKey, P2PKH, Transaction, ARC } from '@bsv/sdk'
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
export function buildTransaction(
  utxos: UTXO[],
  outputs: Array<{ address: string; amount: number }>,
  changeAddress: string,
  privateKey: PrivateKey
): string {
  const tx = new Transaction()

  // Add inputs
  let totalInput = 0
  for (const utxo of utxos) {
    tx.addInput({
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: new P2PKH().unlock(privateKey),
      sequence: 0xffffffff,
    })
    totalInput += utxo.amount
  }

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

  // Calculate fee (1 sat/byte estimate)
  const estimatedSize = tx.toBinary().length + (148 * utxos.length) // rough estimate
  const fee = Math.ceil(estimatedSize * config.feePerByte)

  // Add change output if needed
  const change = totalInput - totalOutput - fee
  if (change > 546) { // dust limit
    const lockingScript = new P2PKH().lock(changeAddress)
    tx.addOutput({
      lockingScript,
      satoshis: change,
    })
  }

  // Sign transaction
  tx.sign()

  return tx.toHex()
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
