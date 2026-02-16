/**
 * AgentPay Configuration
 * 
 * Controls network settings, API endpoints, and platform parameters.
 */

// Demo mode check
const isDemoMode = process.env.AGENTPAY_DEMO === 'true' || process.env.AGENTPAY_DEMO === '1'

// CRITICAL: Enforce master key in production
if (!isDemoMode) {
  if (!process.env.AGENTPAY_MASTER_KEY) {
    console.error('❌ FATAL ERROR: AGENTPAY_MASTER_KEY environment variable not set')
    console.error('Generate a secure key with: openssl rand -hex 32')
    console.error('Set it in .env: AGENTPAY_MASTER_KEY=<your-key>')
    console.error('')
    console.error('For demo/testing only, set AGENTPAY_DEMO=true')
    process.exit(1)
  }

  if (process.env.AGENTPAY_MASTER_KEY.length < 32) {
    console.error('❌ FATAL ERROR: AGENTPAY_MASTER_KEY must be at least 32 characters')
    console.error('Generate a secure key with: openssl rand -hex 32')
    process.exit(1)
  }
}

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

  // Escrow mode: 'platform' (centralized) | 'multisig' (2-of-3 on-chain BSV script)
  escrowMode: (process.env.AGENTPAY_ESCROW_MODE === 'multisig' ? 'multisig' : 'platform') as 'platform' | 'multisig',

  // Demo mode: use internal ledger instead of on-chain transactions
  // Set AGENTPAY_DEMO=true for local testing without real BSV
  demoMode: isDemoMode,

  // Demo mode: skip authentication (for testing only)
  demoSkipAuth: isDemoMode && process.env.AGENTPAY_DEMO_SKIP_AUTH === 'true',

  // Minimum transaction fee (satoshis/byte)
  feePerByte: 1,

  // Private key encryption settings
  encryption: {
    algorithm: 'aes-256-gcm' as const,
    // Master key is REQUIRED (enforced at startup unless in demo mode)
    masterKey: process.env.AGENTPAY_MASTER_KEY || 'demo-mode-insecure-key-for-testing-only',
  },

  // Platform escrow wallet (for MVP)
  // In production, this should be a secure cold wallet
  platformWallet: {
    // These will be generated on first run if not provided
    privateKey: process.env.PLATFORM_WALLET_PRIVKEY,
    address: process.env.PLATFORM_WALLET_ADDRESS,
  },

  // External wallet providers
  handcash: {
    appId: process.env.HANDCASH_APP_ID || '',
    appSecret: process.env.HANDCASH_APP_SECRET || '',
    redirectUrl: process.env.HANDCASH_REDIRECT_URL || 'http://localhost:3100/api/wallets/connect/handcash/callback',
  },

  // Frontend URL (for OAuth callbacks)
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
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
