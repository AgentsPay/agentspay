/**
 * Execution Receipt Types
 * 
 * Cryptographic proof that a service execution occurred with specific
 * inputs, outputs, and timing. Receipts are signed by both provider
 * and platform for dual verification.
 */

export interface ExecutionReceipt {
  id: string                    // Receipt UUID
  paymentId: string             // Associated payment ID
  serviceId: string             // Service that was executed
  inputHash: string             // SHA-256 hash of input data
  outputHash: string            // SHA-256 hash of output data
  timestamp: number             // Unix timestamp (ms)
  executionTimeMs: number       // Service execution duration
  providerSignature: string     // HMAC signature from provider
  platformSignature: string     // HMAC signature from platform
  receiptHash: string           // SHA-256 hash of all above fields
  blockchainTxId?: string       // Optional: BSV txid if anchored
  blockchainAnchoredAt?: string // ISO timestamp of anchoring
}

/**
 * Receipt creation data (before signing)
 */
export interface ReceiptData {
  paymentId: string
  serviceId: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  timestamp: number
  executionTimeMs: number
}

/**
 * Verification result
 */
export interface ReceiptVerification {
  valid: boolean
  errors: string[]
  receipt?: ExecutionReceipt
  blockchainVerified?: boolean
}
