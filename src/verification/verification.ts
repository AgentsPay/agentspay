/**
 * Verification Manager
 * 
 * Handles creation, storage, and verification of execution receipts.
 * Provides cryptographic proof of service execution.
 */

import { v4 as uuid } from 'uuid'
import crypto from 'crypto'
import { getDb } from '../registry/db'
import type { ExecutionReceipt, ReceiptData, ReceiptVerification } from './receipt'
import type { Payment } from '../types'

export class VerificationManager {
  private platformSecret: string

  constructor(platformSecret?: string) {
    // Use environment variable or generate deterministic secret
    this.platformSecret = platformSecret || process.env.AGENTPAY_PLATFORM_SECRET || 'agentspay-platform-secret-change-in-production'
  }

  /**
   * Create an execution receipt after service execution
   */
  async createReceipt(
    payment: Payment,
    input: Record<string, unknown>,
    output: Record<string, unknown>,
    executionTimeMs: number,
    providerSecret?: string
  ): Promise<ExecutionReceipt> {
    const db = getDb()
    const now = Date.now()

    const receiptData: ReceiptData = {
      paymentId: payment.id,
      serviceId: payment.serviceId,
      input,
      output,
      timestamp: now,
      executionTimeMs,
    }

    // Hash inputs and outputs
    const inputHash = this.hashData(input)
    const outputHash = this.hashData(output)

    // Create receipt ID
    const id = uuid()

    // Generate provider signature (if provider secret available)
    const providerSignature = providerSecret 
      ? this.signReceipt(receiptData, providerSecret)
      : this.signReceipt(receiptData, this.platformSecret) // Fallback to platform

    // Generate platform signature
    const platformSignature = this.signReceipt(receiptData, this.platformSecret)

    // Create receipt hash (hash of all fields for integrity)
    const receiptHash = this.hashReceipt({
      id,
      paymentId: payment.id,
      serviceId: payment.serviceId,
      inputHash,
      outputHash,
      timestamp: now,
      executionTimeMs,
      providerSignature,
      platformSignature,
    })

    const receipt: ExecutionReceipt = {
      id,
      paymentId: payment.id,
      serviceId: payment.serviceId,
      inputHash,
      outputHash,
      timestamp: now,
      executionTimeMs,
      providerSignature,
      platformSignature,
      receiptHash,
    }

    // Store in database
    db.prepare(`
      INSERT INTO execution_receipts (
        id, paymentId, serviceId, inputHash, outputHash,
        timestamp, executionTimeMs, providerSignature, platformSignature,
        receiptHash, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.id,
      receipt.paymentId,
      receipt.serviceId,
      receipt.inputHash,
      receipt.outputHash,
      receipt.timestamp,
      receipt.executionTimeMs,
      receipt.providerSignature,
      receipt.platformSignature,
      receipt.receiptHash,
      new Date(now).toISOString()
    )

    return receipt
  }

  /**
   * Get receipt by payment ID
   */
  getReceipt(paymentId: string): ExecutionReceipt | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT id, paymentId, serviceId, inputHash, outputHash,
             timestamp, executionTimeMs, providerSignature, platformSignature,
             receiptHash, blockchainTxId, blockchainAnchoredAt
      FROM execution_receipts
      WHERE paymentId = ?
    `).get(paymentId) as any

    if (!row) return null

    return {
      id: row.id,
      paymentId: row.paymentId,
      serviceId: row.serviceId,
      inputHash: row.inputHash,
      outputHash: row.outputHash,
      timestamp: row.timestamp,
      executionTimeMs: row.executionTimeMs,
      providerSignature: row.providerSignature,
      platformSignature: row.platformSignature,
      receiptHash: row.receiptHash,
      blockchainTxId: row.blockchainTxId || undefined,
      blockchainAnchoredAt: row.blockchainAnchoredAt || undefined,
    }
  }

  /**
   * Verify receipt integrity and signatures
   */
  async verifyReceipt(receipt: ExecutionReceipt): Promise<ReceiptVerification> {
    const errors: string[] = []

    // 1. Verify receipt hash integrity
    const expectedHash = this.hashReceipt({
      id: receipt.id,
      paymentId: receipt.paymentId,
      serviceId: receipt.serviceId,
      inputHash: receipt.inputHash,
      outputHash: receipt.outputHash,
      timestamp: receipt.timestamp,
      executionTimeMs: receipt.executionTimeMs,
      providerSignature: receipt.providerSignature,
      platformSignature: receipt.platformSignature,
    })

    if (expectedHash !== receipt.receiptHash) {
      errors.push('Receipt hash mismatch - data has been tampered')
    }

    // 2. Verify platform signature
    const receiptData: ReceiptData = {
      paymentId: receipt.paymentId,
      serviceId: receipt.serviceId,
      input: {}, // We don't store raw input, only hash
      output: {},
      timestamp: receipt.timestamp,
      executionTimeMs: receipt.executionTimeMs,
    }

    const expectedPlatformSig = this.signReceipt(receiptData, this.platformSecret)
    if (expectedPlatformSig !== receipt.platformSignature) {
      errors.push('Platform signature invalid')
    }

    // 3. Check if exists in database
    const stored = this.getReceipt(receipt.paymentId)
    if (!stored) {
      errors.push('Receipt not found in database')
    } else if (stored.receiptHash !== receipt.receiptHash) {
      errors.push('Receipt does not match stored version')
    }

    // 4. Optional: Verify blockchain anchor
    let blockchainVerified = false
    if (receipt.blockchainTxId) {
      // TODO: Implement blockchain verification via WhatsOnChain API
      // For now, just flag as anchored
      blockchainVerified = true
    }

    return {
      valid: errors.length === 0,
      errors,
      receipt,
      blockchainVerified,
    }
  }

  /**
   * Update receipt with blockchain anchor
   */
  async anchorToBlockchain(receiptHash: string, txId: string): Promise<void> {
    const db = getDb()
    const now = new Date().toISOString()

    db.prepare(`
      UPDATE execution_receipts
      SET blockchainTxId = ?, blockchainAnchoredAt = ?
      WHERE receiptHash = ?
    `).run(txId, now, receiptHash)
  }

  /**
   * Hash arbitrary data (for inputs/outputs)
   */
  private hashData(data: Record<string, unknown>): string {
    const json = JSON.stringify(data, Object.keys(data).sort()) // Deterministic
    return crypto.createHash('sha256').update(json).digest('hex')
  }

  /**
   * Hash receipt fields for integrity check
   */
  private hashReceipt(fields: Omit<ExecutionReceipt, 'receiptHash' | 'blockchainTxId' | 'blockchainAnchoredAt'>): string {
    const canonical = JSON.stringify({
      id: fields.id,
      paymentId: fields.paymentId,
      serviceId: fields.serviceId,
      inputHash: fields.inputHash,
      outputHash: fields.outputHash,
      timestamp: fields.timestamp,
      executionTimeMs: fields.executionTimeMs,
      providerSignature: fields.providerSignature,
      platformSignature: fields.platformSignature,
    })
    return crypto.createHash('sha256').update(canonical).digest('hex')
  }

  /**
   * Sign receipt data with HMAC-SHA256
   */
  private signReceipt(data: ReceiptData, secret: string): string {
    const canonical = JSON.stringify({
      paymentId: data.paymentId,
      serviceId: data.serviceId,
      inputHash: this.hashData(data.input),
      outputHash: this.hashData(data.output),
      timestamp: data.timestamp,
      executionTimeMs: data.executionTimeMs,
    })
    return crypto.createHmac('sha256', secret).update(canonical).digest('hex')
  }
}
