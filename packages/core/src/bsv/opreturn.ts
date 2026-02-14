/**
 * BSV OP_RETURN Transaction Builder
 * 
 * Anchors receipt hashes to the BSV blockchain via OP_RETURN.
 * Creates an immutable, timestamped proof of execution.
 * 
 * Cost: ~1 satoshi per anchor
 */

import { PrivateKey, Transaction, P2PKH, Script } from '@bsv/sdk'
import { broadcastTx, getUtxos } from './whatsonchain'
import { config } from '../config'

export interface AnchorResult {
  txId: string
  receiptHash: string
  cost: number // satoshis
}

/**
 * Anchor a receipt hash to BSV blockchain via OP_RETURN
 */
export async function anchorReceiptHash(
  receiptHash: string,
  privateKeyWif: string,
  sourceAddress: string
): Promise<AnchorResult> {
  if (config.demoMode) {
    // Demo mode: return fake txid
    return {
      txId: `demo-anchor-${receiptHash.slice(0, 8)}`,
      receiptHash,
      cost: 1,
    }
  }

  // Get UTXOs for funding
  const utxos = await getUtxos(sourceAddress)
  if (utxos.length === 0) {
    throw new Error('No UTXOs available for anchoring')
  }

  const totalInput = utxos.reduce((sum, u) => sum + u.value, 0)
  if (totalInput < 1000) {
    throw new Error('Insufficient funds for anchoring (need at least 1000 sats)')
  }

  // Create OP_RETURN script with receipt hash
  const opReturnScript = Script.fromASM(`OP_FALSE OP_RETURN ${Buffer.from(receiptHash, 'hex').toString('hex')}`)

  // Build transaction
  const privKey = PrivateKey.fromWif(privateKeyWif)
  const tx = new Transaction()

  // Add inputs
  for (const utxo of utxos) {
    tx.addInput({
      sourceTXID: utxo.tx_hash,
      sourceOutputIndex: utxo.tx_pos,
      unlockingScriptTemplate: new P2PKH().unlock(privKey),
      sequence: 0xffffffff,
    })
  }

  // Add OP_RETURN output (0 satoshis)
  tx.addOutput({
    lockingScript: opReturnScript,
    change: false,
    satoshis: 0,
  })

  // Add change output
  tx.addOutput({
    lockingScript: new P2PKH().lock(sourceAddress),
    change: true,
  })

  // Sign transaction
  await tx.fee()
  await tx.sign()

  // Broadcast
  const txHex = tx.toHex()
  const txId = await broadcastTx(txHex)

  // Calculate actual cost (input - change)
  const outputs = tx.outputs || []
  const changeOutput = outputs.find(o => o.change)
  const changeAmount = changeOutput?.satoshis || 0
  const cost = totalInput - changeAmount

  return {
    txId,
    receiptHash,
    cost,
  }
}

/**
 * Verify that a receipt hash exists in a BSV transaction's OP_RETURN
 */
export async function verifyAnchor(txId: string, expectedHash: string): Promise<boolean> {
  try {
    // Fetch transaction from blockchain
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txId}/hex`)
    if (!response.ok) return false

    const txHex = await response.text()
    const tx = Transaction.fromHex(txHex)

    // Look for OP_RETURN output with our hash
    const outputs = tx.outputs || []
    for (const output of outputs) {
      const script = output.lockingScript
      if (!script) continue

      const asm = script.toASM()
      if (asm.includes('OP_RETURN')) {
        // Extract data after OP_RETURN
        const parts = asm.split(' ')
        const returnIndex = parts.indexOf('OP_RETURN')
        if (returnIndex !== -1 && parts.length > returnIndex + 1) {
          const data = parts[returnIndex + 1]
          const hashFromTx = Buffer.from(data, 'hex').toString('hex')
          if (hashFromTx === expectedHash) {
            return true
          }
        }
      }
    }

    return false
  } catch (error) {
    console.error('Error verifying anchor:', error)
    return false
  }
}
