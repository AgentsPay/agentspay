// Core exports - Config and Types
export * from './config'
export * from './types'

// Wallet
export { WalletManager } from './wallet/wallet'
export { ProviderManager } from './wallet/providerManager'

// Payment
export { PaymentEngine } from './payment/payment'
export type { SettlementAction, SettlementActorType, SettlementApproval, AdminMultisigSigningPayload } from './payment/payment'

// Registry
export { Registry } from './registry/registry'
export { getDb } from './registry/db'

// Jobs
export { JobManager } from './jobs/jobManager'

// Disputes
export { DisputeManager, DisputeResolution } from './disputes/dispute'

// Webhooks
export { WebhookManager, Webhook, WEBHOOK_EVENTS, WebhookEvent } from './webhooks/webhook'
export { webhookDelivery } from './webhooks/delivery'

// Verification
export { VerificationManager } from './verification/verification'
export { ReceiptData, ReceiptVerification } from './verification/receipt'

// Currency
export { CurrencyManager, CurrencyConfig, ConversionRate } from './currency/currency'

// BSV
export * from './bsv/crypto'
export * from './bsv/whatsonchain'
export { mneeTokens } from './bsv/mnee'
export * from './bsv/opreturn'

// Utils
export * from './utils/validation'

// Agent Identity
export { AgentIdentityManager } from './identity/agentIdentity'
export type { AgentIdentity, IdentityAttestation } from './identity/agentIdentity'

// Contracts
export { ContractManager } from './contracts/contract'
export type { ServiceContract, ContractStatus } from './contracts/contract'
