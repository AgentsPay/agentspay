/**
 * BSV Crypto Utilities
 * 
 * Handles key generation, encryption, address derivation, and transaction building.
 */

import {
  PrivateKey,
  PublicKey,
  P2PKH,
  Transaction,
  Script,
  UnlockingScript,
  TransactionSignature,
  Hash,
} from '@bsv/sdk'
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

export interface MultisigTxOutput {
  address: string
  amount: number
}

export interface MultisigSigningPayload {
  txHex: string
  digestHex: string
  preimageHex: string
  sighashType: number
}

function opN(n: number): string {
  if (n < 0 || n > 16) throw new Error('Invalid OP_N value')
  if (n === 0) return 'OP_0'
  return `OP_${n}`
}

/**
 * Build a bare multisig locking script (m-of-n).
 * Example (2-of-3):
 * OP_2 <pub1> <pub2> <pub3> OP_3 OP_CHECKMULTISIG
 */
export function buildMultisigLockingScript(publicKeysHex: string[], requiredSigs = 2): Script {
  const unique = Array.from(new Set(publicKeysHex.map((k) => k.trim()).filter(Boolean))).sort()
  if (unique.length < 2) throw new Error('At least 2 public keys are required for multisig')
  if (requiredSigs < 1 || requiredSigs > unique.length) throw new Error('Invalid required signatures for multisig')

  for (const keyHex of unique) {
    if (!/^[0-9a-fA-F]+$/.test(keyHex)) throw new Error('Invalid public key hex in multisig set')
  }

  const asm = `${opN(requiredSigs)} ${unique.join(' ')} ${opN(unique.length)} OP_CHECKMULTISIG`
  return Script.fromASM(asm)
}

/**
 * Build and sign a funding transaction that sends satoshis to a custom locking script.
 */
export async function buildTransactionToLockingScript(
  utxos: UTXO[],
  lockingScript: Script,
  amount: number,
  changeAddress: string,
  privateKey: PrivateKey
): Promise<{ txHex: string; escrowVout: number }> {
  const tx = new Transaction()
  let totalInput = 0

  for (const utxo of utxos) {
    const inputLockingScript = Script.fromHex(utxo.script)
    const unlockTemplate = new P2PKH().unlock(privateKey)
    const sourceOutputs = Array.from({ length: utxo.vout + 1 }, (_v, idx) => ({
      lockingScript: inputLockingScript,
      satoshis: idx === utxo.vout ? utxo.amount : 0,
    }))

    tx.addInput({
      sourceTransaction: { outputs: sourceOutputs } as any,
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: unlockTemplate,
      sequence: 0xffffffff,
    })

    totalInput += utxo.amount
  }

  tx.addOutput({ lockingScript, satoshis: amount })
  const escrowVout = 0

  const estimatedSize = 10 + (148 * utxos.length) + (43 * 2)
  const fee = Math.max(300, Math.ceil(estimatedSize * config.feePerByte))
  const change = totalInput - amount - fee
  if (change < 0) throw new Error('Insufficient input for locking-script transaction')

  if (change > 546) {
    tx.addOutput({ lockingScript: new P2PKH().lock(changeAddress), satoshis: change })
  }

  await tx.sign()
  return { txHex: tx.toHex(), escrowVout }
}

/**
 * Spend a bare 2-of-3 multisig output using two private keys.
 */
export async function spendMultisigUtxo(params: {
  utxo: { txid: string; vout: number; amount: number }
  lockingScriptHex: string
  signerPrivateKeys?: PrivateKey[]
  signerPublicKeys?: string[]
  providedChecksigSignaturesHex?: string[]
  outputs: MultisigTxOutput[]
  changeAddress?: string
}): Promise<string> {
  const tx = new Transaction()
  const lockingScript = Script.fromHex(params.lockingScriptHex)
  const signingPayload = getMultisigSigningPayload({
    utxo: params.utxo,
    lockingScriptHex: params.lockingScriptHex,
    outputs: params.outputs,
    changeAddress: params.changeAddress,
  })
  const scriptAsm = lockingScript.toASM()
  const scriptPubkeys = scriptAsm
    .split(' ')
    .filter((t) => /^[0-9a-fA-F]{66,130}$/.test(t))
    .map((k) => k.toLowerCase())
  if (scriptPubkeys.length < 2) throw new Error('Invalid multisig locking script (pubkeys not found)')

  const signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL
  const sigByPubkey = new Map<string, number[]>()

  for (const priv of params.signerPrivateKeys || []) {
    const pubHex = priv.toPublicKey().toString().toLowerCase()
    if (!scriptPubkeys.includes(pubHex)) throw new Error('Signer private key not present in multisig script')
    const digest = Hash.sha256(Buffer.from(signingPayload.preimageHex, 'hex'))
    const raw = priv.sign(digest)
    const txSig = new TransactionSignature(raw.r, raw.s, signatureScope)
    sigByPubkey.set(pubHex, txSig.toChecksigFormat())
  }

  const providedSigs = params.providedChecksigSignaturesHex || []
  const providedPubs = (params.signerPublicKeys || []).map((k) => k.toLowerCase())
  if (providedSigs.length !== providedPubs.length) {
    throw new Error('signerPublicKeys and providedChecksigSignaturesHex must have same length')
  }

  for (let i = 0; i < providedSigs.length; i++) {
    const pubHex = providedPubs[i]
    const sigHex = providedSigs[i]
    if (!pubHex || !sigHex) continue
    if (!scriptPubkeys.includes(pubHex)) throw new Error('Provided signature pubkey not present in multisig script')
    const txSig = TransactionSignature.fromChecksigFormat(Array.from(Buffer.from(sigHex, 'hex')))
    const pub = PublicKey.fromString(pubHex)
    const digest = Hash.sha256(Buffer.from(signingPayload.preimageHex, 'hex'))
    if (!pub.verify(digest, txSig)) throw new Error('Provided multisig signature failed verification')
    sigByPubkey.set(pubHex, txSig.toChecksigFormat())
  }

  if (sigByPubkey.size < 2) throw new Error('At least 2 multisig signatures are required to spend UTXO')

  // Respect locking script key ordering for CHECKMULTISIG matching.
  const orderedSigs = scriptPubkeys
    .filter((pub) => sigByPubkey.has(pub))
    .map((pub) => sigByPubkey.get(pub)!)
    .slice(0, 2)

  const unlockTemplate = {
    sign: async (_t: Transaction, _inputIndex: number) => {
      return new UnlockingScript([
        { op: 0 }, // CHECKMULTISIG bug dummy
        ...orderedSigs.map((s) => ({ op: s.length, data: s })),
      ])
    },
    estimateLength: async () => {
      // OP_0 + two signatures (worst case DER+scope)
      return 1 + (1 + 73) + (1 + 73)
    },
  }

  tx.addInput({
    sourceTXID: params.utxo.txid,
    sourceOutputIndex: params.utxo.vout,
    unlockingScriptTemplate: unlockTemplate,
    sequence: 0xffffffff,
  })

  for (const output of params.outputs) {
    tx.addOutput({ lockingScript: new P2PKH().lock(output.address), satoshis: output.amount })
  }

  await tx.sign()
  return tx.toHex()
}

export function getMultisigSigningPayload(params: {
  utxo: { txid: string; vout: number; amount: number }
  lockingScriptHex: string
  outputs: MultisigTxOutput[]
  changeAddress?: string
}): MultisigSigningPayload {
  const tx = new Transaction()
  const lockingScript = Script.fromHex(params.lockingScriptHex)

  tx.addInput({
    sourceTXID: params.utxo.txid,
    sourceOutputIndex: params.utxo.vout,
    sequence: 0xffffffff,
  })

  let totalOutput = 0
  for (const output of params.outputs) {
    tx.addOutput({ lockingScript: new P2PKH().lock(output.address), satoshis: output.amount })
    totalOutput += output.amount
  }

  const estimatedSize = 10 + 260 + (34 * (params.outputs.length + 1))
  const fee = Math.max(350, Math.ceil(estimatedSize * config.feePerByte))
  const change = params.utxo.amount - totalOutput - fee
  if (change < 0) throw new Error('Insufficient multisig escrow amount after fee')

  if (params.changeAddress && change > 546) {
    tx.addOutput({ lockingScript: new P2PKH().lock(params.changeAddress), satoshis: change })
  } else if (!params.changeAddress && change > 546) {
    const firstOutput = tx.outputs[0]
    if (!firstOutput) throw new Error('No outputs to absorb multisig residue')
    firstOutput.satoshis = (firstOutput.satoshis || 0) + change
  }

  const signatureScope = TransactionSignature.SIGHASH_FORKID | TransactionSignature.SIGHASH_ALL
  const input = tx.inputs[0]
  if (!input?.sourceTXID) throw new Error('Missing sourceTXID while creating multisig signing payload')
  const preimage = TransactionSignature.format({
    sourceTXID: input.sourceTXID,
    sourceOutputIndex: input.sourceOutputIndex!,
    sourceSatoshis: params.utxo.amount,
    transactionVersion: tx.version,
    otherInputs: [],
    inputIndex: 0,
    outputs: tx.outputs,
    inputSequence: input.sequence!,
    subscript: lockingScript,
    lockTime: tx.lockTime,
    scope: signatureScope,
  })
  const digest = Hash.sha256(preimage)

  return {
    txHex: tx.toHex(),
    preimageHex: Buffer.from(preimage).toString('hex'),
    digestHex: Buffer.from(digest).toString('hex'),
    sighashType: signatureScope,
  }
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
  const tx = new Transaction()

  // Add inputs
  let totalInput = 0
  for (const utxo of utxos) {
    const lockingScript = Script.fromHex(utxo.script)
    const unlockTemplate = new P2PKH().unlock(privateKey)

    const sourceOutputs = Array.from({ length: utxo.vout + 1 }, (_v, idx) => ({
      lockingScript,
      satoshis: idx === utxo.vout ? utxo.amount : 0,
    }))

    tx.addInput({
      sourceTransaction: {
        outputs: sourceOutputs,
      } as any,
      sourceTXID: utxo.txid,
      sourceOutputIndex: utxo.vout,
      unlockingScriptTemplate: unlockTemplate,
      sequence: 0xffffffff,
    })

    totalInput += utxo.amount
  }

  // Add outputs
  let totalOutput = 0
  for (const output of outputs) {
    const lockingScript = new P2PKH().lock(output.address)
    tx.addOutput({ lockingScript, satoshis: output.amount })
    totalOutput += output.amount
  }

  // Fee estimate without serializing (sdk needs unlocking scripts to serialize)
  // P2PKH input: ~148 bytes, P2PKH output: ~34 bytes, overhead: ~10 bytes
  const estimatedSize = 10 + (148 * utxos.length) + (34 * (outputs.length + 1)) // +1 for potential change
  const fee = Math.max(250, Math.ceil(estimatedSize * config.feePerByte)) // Minimum 250 sats

  // Add change output if needed
  const change = totalInput - totalOutput - fee
  if (change > 546) {
    const lockingScript = new P2PKH().lock(changeAddress)
    tx.addOutput({ lockingScript, satoshis: change })
  }

  await tx.sign()
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

/**
 * Get P2PKH locking script hex for an address
 */
export function getScriptForAddress(address: string): string {
  const lockingScript = new P2PKH().lock(address)
  return lockingScript.toHex()
}
