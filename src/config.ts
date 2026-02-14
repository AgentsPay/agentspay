/**
 * AgentPay Configuration
 * 
 * Controls network settings, API endpoints, and platform parameters.
 */

export const config = {
  // BSV Network: 'mainnet' | 'testnet'
  network: (process.env.BSV_NETWORK || 'testnet') as 'mainnet' | 'testnet',

  // WhatsOnChain API base URL
  whatsOnChainBase: process.env.BSV_NETWORK === 'mainnet'
    ? 'https://api.whatsonchain.com/v1/bsv/main'
    : 'https://api.whatsonchain.com/v1/bsv/test',

  // WhatsOnChain explorer base URL
  explorerBase: process.env.BSV_NETWORK === 'mainnet'
    ? 'https://whatsonchain.com/tx'
    : 'https://test.whatsonchain.com/tx',

  // Platform fee rate (2%)
  platformFeeRate: 0.02,

  // Escrow mode: 'platform' (centralized) | 'multisig' (future)
  escrowMode: 'platform' as 'platform' | 'multisig',

  // Minimum transaction fee (satoshis/byte)
  feePerByte: 1,

  // Private key encryption settings
  encryption: {
    algorithm: 'aes-256-gcm' as const,
    // In production, use a secure key management system (KMS)
    // For MVP, we'll store encrypted keys with a master key from env
    masterKey: process.env.AGENTPAY_MASTER_KEY || 'dev-only-insecure-key-change-in-prod',
  },

  // Platform escrow wallet (for MVP)
  // In production, this should be a secure cold wallet
  platformWallet: {
    // These will be generated on first run if not provided
    privateKey: process.env.PLATFORM_WALLET_PRIVKEY,
    address: process.env.PLATFORM_WALLET_ADDRESS,
  },
}

/**
 * Get the appropriate network prefix for P2PKH addresses
 */
export function getAddressPrefix(): number {
  return config.network === 'mainnet' ? 0x00 : 0x6f
}

/**
 * Get WhatsOnChain URL for a transaction
 */
export function getTxUrl(txId: string): string {
  return `${config.explorerBase}/${txId}`
}
