import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { BSM, PrivateKey, PublicKey, Signature } from '@bsv/sdk'
import { getDb } from '../registry/db'
import { anchorReceiptHash } from '../bsv/opreturn'
import type { Currency } from '../types'

export type ContractStatus = 'active' | 'released' | 'refunded' | 'disputed'

export interface ServiceContract {
  id: string
  serviceId: string
  buyerWalletId: string
  providerWalletId: string
  buyerAddress: string
  providerAddress: string
  amount: number
  currency: Currency
  termsHash: string
  disputeWindow: number
  contractHash: string
  buyerSignature: string
  providerSignature: string
  status: ContractStatus
  contractTxId?: string
  settlementTxId?: string
  createdAt: string
  settledAt?: string
}

export class ContractManager {
  private canonicalPayload(input: {
    serviceId: string
    buyerWalletId: string
    providerWalletId: string
    buyerAddress: string
    providerAddress: string
    amount: number
    currency: Currency
    termsHash: string
    disputeWindow: number
  }): string {
    return JSON.stringify({
      version: 1,
      domain: 'agentpay.service.contract',
      serviceId: input.serviceId,
      buyerWalletId: input.buyerWalletId,
      providerWalletId: input.providerWalletId,
      buyerAddress: input.buyerAddress,
      providerAddress: input.providerAddress,
      amount: input.amount,
      currency: input.currency,
      termsHash: input.termsHash,
      disputeWindow: input.disputeWindow,
    })
  }

  private signMessage(message: string, privateKeyWif: string): string {
    const bytes = Array.from(Buffer.from(message, 'utf8'))
    const priv = PrivateKey.fromWif(privateKeyWif)
    return BSM.sign(bytes, priv, 'base64') as string
  }

  private verifyMessage(message: string, signatureBase64: string, publicKeyHex: string): boolean {
    try {
      const bytes = Array.from(Buffer.from(message, 'utf8'))
      const sig = Signature.fromCompact(signatureBase64, 'base64')
      const pub = PublicKey.fromString(publicKeyHex)
      return BSM.verify(bytes, sig, pub)
    } catch {
      return false
    }
  }

  private rowToContract(row: any): ServiceContract {
    return {
      id: row.id,
      serviceId: row.serviceId,
      buyerWalletId: row.buyerWalletId,
      providerWalletId: row.providerWalletId,
      buyerAddress: row.buyerAddress,
      providerAddress: row.providerAddress,
      amount: row.amount,
      currency: row.currency,
      termsHash: row.termsHash,
      disputeWindow: row.disputeWindow,
      contractHash: row.contractHash,
      buyerSignature: row.buyerSignature,
      providerSignature: row.providerSignature,
      status: row.status,
      contractTxId: row.contractTxId || undefined,
      settlementTxId: row.settlementTxId || undefined,
      createdAt: row.createdAt,
      settledAt: row.settledAt || undefined,
    }
  }

  async createAndAnchor(params: {
    serviceId: string
    buyerWalletId: string
    providerWalletId: string
    buyerAddress: string
    providerAddress: string
    buyerPublicKey: string
    providerPublicKey: string
    buyerPrivateKeyWif: string
    providerPrivateKeyWif: string
    amount: number
    currency: Currency
    termsHash: string
    disputeWindow: number
  }): Promise<ServiceContract> {
    const db = getDb()
    const id = uuid()
    const createdAt = new Date().toISOString()
    const payload = this.canonicalPayload({
      serviceId: params.serviceId,
      buyerWalletId: params.buyerWalletId,
      providerWalletId: params.providerWalletId,
      buyerAddress: params.buyerAddress,
      providerAddress: params.providerAddress,
      amount: params.amount,
      currency: params.currency,
      termsHash: params.termsHash,
      disputeWindow: params.disputeWindow,
    })
    const contractHash = crypto.createHash('sha256').update(payload).digest('hex')
    const messageToSign = `AgentPayContract:${contractHash}`

    const buyerSignature = this.signMessage(messageToSign, params.buyerPrivateKeyWif)
    const providerSignature = this.signMessage(messageToSign, params.providerPrivateKeyWif)
    if (!this.verifyMessage(messageToSign, buyerSignature, params.buyerPublicKey)) {
      throw new Error('Buyer signature verification failed')
    }
    if (!this.verifyMessage(messageToSign, providerSignature, params.providerPublicKey)) {
      throw new Error('Provider signature verification failed')
    }

    let contractTxId: string | undefined
    try {
      const anchor = await anchorReceiptHash(contractHash, params.buyerPrivateKeyWif, params.buyerAddress)
      contractTxId = anchor.txId
    } catch {
      // Contract exists and is signed even if anchoring fails in this attempt.
      contractTxId = undefined
    }

    db.prepare(`
      INSERT INTO service_contracts (
        id, serviceId, buyerWalletId, providerWalletId, buyerAddress, providerAddress,
        amount, currency, termsHash, disputeWindow, contractHash, buyerSignature,
        providerSignature, status, contractTxId, createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      params.serviceId,
      params.buyerWalletId,
      params.providerWalletId,
      params.buyerAddress,
      params.providerAddress,
      params.amount,
      params.currency,
      params.termsHash,
      params.disputeWindow,
      contractHash,
      buyerSignature,
      providerSignature,
      contractTxId || null,
      createdAt
    )

    const created = this.getById(id)
    if (!created) throw new Error('Failed to create contract')
    return created
  }

  getById(id: string): ServiceContract | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM service_contracts WHERE id = ?').get(id) as any
    return row ? this.rowToContract(row) : null
  }

  getByPaymentId(paymentId: string): ServiceContract | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT c.* FROM service_contracts c
      JOIN payments p ON p.contractId = c.id
      WHERE p.id = ?
    `).get(paymentId) as any
    return row ? this.rowToContract(row) : null
  }

  setStatusByPaymentId(paymentId: string, status: ContractStatus, settlementTxId?: string): void {
    const db = getDb()
    const contract = this.getByPaymentId(paymentId)
    if (!contract) return
    db.prepare(`
      UPDATE service_contracts
      SET status = ?, settlementTxId = ?, settledAt = ?
      WHERE id = ?
    `).run(status, settlementTxId || null, new Date().toISOString(), contract.id)
  }

  verifyContract(contractId: string): { valid: boolean; errors: string[]; contract?: ServiceContract } {
    const db = getDb()
    const row = db.prepare(`
      SELECT c.*, bw.publicKey as buyerPublicKey, pw.publicKey as providerPublicKey
      FROM service_contracts c
      JOIN wallets bw ON bw.id = c.buyerWalletId
      JOIN wallets pw ON pw.id = c.providerWalletId
      WHERE c.id = ?
    `).get(contractId) as any
    if (!row) return { valid: false, errors: ['Contract not found'] }

    const contract = this.rowToContract(row)
    const payload = this.canonicalPayload({
      serviceId: contract.serviceId,
      buyerWalletId: contract.buyerWalletId,
      providerWalletId: contract.providerWalletId,
      buyerAddress: contract.buyerAddress,
      providerAddress: contract.providerAddress,
      amount: contract.amount,
      currency: contract.currency,
      termsHash: contract.termsHash,
      disputeWindow: contract.disputeWindow,
    })
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex')
    const messageToSign = `AgentPayContract:${contract.contractHash}`
    const errors: string[] = []

    if (expectedHash !== contract.contractHash) errors.push('Contract hash mismatch')
    if (!this.verifyMessage(messageToSign, contract.buyerSignature, row.buyerPublicKey)) {
      errors.push('Buyer signature invalid')
    }
    if (!this.verifyMessage(messageToSign, contract.providerSignature, row.providerPublicKey)) {
      errors.push('Provider signature invalid')
    }

    return {
      valid: errors.length === 0,
      errors,
      contract,
    }
  }
}
