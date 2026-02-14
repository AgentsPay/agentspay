# BSV Real Integration - AgentPay

## Overview

AgentPay now uses **real BSV blockchain transactions** via the `@bsv/sdk` library and WhatsOnChain API.

### What Changed

#### ✅ Real BSV Wallets
- Private keys generated using `PrivateKey.fromRandom()` from @bsv/sdk
- Real P2PKH addresses (testnet/mainnet compatible)
- Private keys stored **encrypted** in database (AES-256-GCM)
- Balance fetched from blockchain via WhatsOnChain API

#### ✅ Real Transactions
- **Escrow payments**: Buyer → Platform escrow wallet (on-chain tx)
- **Release**: Platform → Seller (on-chain tx)
- **Refund**: Platform → Buyer (on-chain tx)
- All transactions broadcast to BSV blockchain via WhatsOnChain
- Transaction IDs stored and linked in database

#### ✅ UTXO Management
- UTXOs fetched from WhatsOnChain API
- Local UTXO cache in database for reliability
- Proper change handling in transactions
- Spent/unspent tracking

#### ✅ Network Support
- **Testnet** (default) - safe for development
- **Mainnet** - production ready
- Controlled via `BSV_NETWORK` environment variable

---

## Architecture

### Platform Escrow (MVP)

For simplicity, AgentPay uses a **centralized platform escrow**:

1. **Buyer** creates payment → sends BSV to **platform wallet** (escrowed on-chain)
2. Service executes successfully → **platform** sends BSV to **seller**
3. Service fails → **platform** refunds **buyer**

**Pros:**
- Simple, fast, reliable
- No complex smart contracts
- Works today

**Cons:**
- Requires trust in platform
- Platform must secure escrow wallet

**Future:**
- Implement hashlock (HTLC) for trustless escrow
- Or 2-of-3 multisig (buyer, seller, arbiter)

---

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Network (testnet recommended for development)
BSV_NETWORK=testnet

# Platform escrow wallet (REQUIRED for production)
# Leave empty for dev/testnet - will auto-generate
PLATFORM_WALLET_PRIVKEY=your_wif_private_key
PLATFORM_WALLET_ADDRESS=your_bsv_address

# Master encryption key for user wallets
# Use a strong random key in production
AGENTPAY_MASTER_KEY=your_secure_master_key_here

# Database path
AGENTPAY_DB=./data/agentpay.db

# API Port
PORT=3100
```

### Security Notes

⚠️ **CRITICAL FOR PRODUCTION:**

1. **Platform Wallet Private Key**
   - Store in a **secure key management system** (AWS KMS, HashiCorp Vault, etc.)
   - Never commit to git
   - Use cold storage for mainnet
   - Enable multi-sig if possible

2. **Master Encryption Key**
   - Used to encrypt user private keys in database
   - Must be **strong and random** (32+ bytes)
   - Rotate periodically
   - Store separately from database

3. **Database Encryption**
   - Encrypt database at rest (OS-level or SQLite extensions)
   - Restrict access permissions
   - Regular backups

---

## New Files

```
src/
├── config.ts                    # Network and API configuration
├── bsv/
│   ├── crypto.ts                # Key generation, encryption, transaction building
│   └── whatsonchain.ts          # Blockchain API client
├── wallet/wallet.ts             # Updated with real BSV support
├── payment/payment.ts           # Updated with on-chain transactions
└── registry/db.ts               # Updated schema (privateKey, utxos table)
```

---

## API Changes

### New Endpoints

#### `GET /api/wallets/:id/utxos`
Returns all unspent transaction outputs for a wallet.

**Response:**
```json
{
  "ok": true,
  "utxos": [
    {
      "txid": "abc123...",
      "vout": 0,
      "amount": 50000,
      "script": "76a914..."
    }
  ]
}
```

#### `GET /api/wallets/:id/transactions`
Returns transaction history for a wallet address.

**Response:**
```json
{
  "ok": true,
  "transactions": [
    {
      "tx_hash": "abc123...",
      "height": 123456,
      "time": 1234567890
    }
  ]
}
```

### Modified Endpoints

#### `GET /api/wallets/:id`
Now returns **on-chain balance** from WhatsOnChain API.

#### `POST /api/wallets/:id/fund` (testnet only)
Now returns faucet links instead of crediting balance directly.

#### `POST /api/execute/:serviceId`
Now creates **real on-chain escrow transaction**.

**Response includes:**
```json
{
  "ok": true,
  "paymentId": "payment-uuid",
  "txId": "abc123...",  // ← New: BSV transaction ID
  "output": { ... },
  "cost": { ... }
}
```

---

## Database Schema Updates

### `wallets` table
- Added `privateKey TEXT` (encrypted)

### `payments` table
- Added `escrowTxId TEXT` (tx when buyer → platform)
- Added `releaseTxId TEXT` (tx when platform → seller/buyer)

### New `utxos` table
```sql
CREATE TABLE utxos (
  id TEXT PRIMARY KEY,           -- txid:vout
  walletId TEXT NOT NULL,
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  script TEXT NOT NULL,
  spent INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  spentAt TEXT,
  UNIQUE(txid, vout)
);
```

---

## Demo

### Run the demo

```bash
npm run demo
```

### What it does:

1. Creates two wallets (provider + consumer) with **real BSV keys**
2. Provider registers a service
3. Consumer gets a **real testnet address**
4. Demo instructs you to fund via testnet faucet:
   - https://faucet.satoshisvision.network/
5. If funded, executes the service and creates **real on-chain transactions**
6. Shows transaction IDs and links to WhatsOnChain explorer

### Expected output (testnet):

```
═══════════════════════════════════════
  🚀 AgentPay Demo: Agent-to-Agent Payment
═══════════════════════════════════════

📡 Step 1: Starting mock provider service...
   Provider "TextAnalyzer" listening on :3101

👛 Step 2: Creating agent wallets...
   Provider wallet: abc12345... (mxyz1234...)
   Consumer wallet: def67890... (mxyz5678...)

📋 Step 3: Provider registers "TextAnalyzer" service...
   Service registered: TextAnalyzer (1000 sats)

🔍 Step 4: Consumer searches for NLP services...
   Found 1 service(s):
   → TextAnalyzer: Analyzes text... (1000 sats)

🪙 Step 5: Consumer needs to fund wallet via testnet faucet...
   Consumer address: mxyz5678...
   Fund at: https://faucet.satoshisvision.network/
   Current balance: 0 sats

   ⚠️  Wallet has 0 balance. For a real demo:
   1. Send testnet BSV to: mxyz5678...
   2. Wait for confirmation
   3. Re-run this demo

   Skipping execution step...

💰 Step 6: Skipped (insufficient balance)

═══════════════════════════════════════
  ✅ Demo complete! AgentPay with REAL BSV
  Network: BSV Testnet
  Provider: mxyz1234...
  Consumer: mxyz5678...
═══════════════════════════════════════
```

---

## Testing

### 1. Build

```bash
npm run build
```

Should complete with **0 errors**.

### 2. Run demo

```bash
npm run demo
```

Creates real wallets and shows testnet addresses.

### 3. Fund a wallet

Use a BSV testnet faucet:
- https://faucet.satoshisvision.network/
- https://testnet.satoshisvision.network/faucet

Send testnet BSV to the consumer address shown in the demo.

### 4. Re-run demo

After funding, the demo will execute the full payment flow with real transactions.

### 5. Verify on blockchain

Check transactions on WhatsOnChain testnet explorer:
- https://test.whatsonchain.com/tx/[txid]

---

## Transaction Fees

BSV transaction fees are **~1 satoshi per byte**.

For typical AgentPay transactions:
- Escrow tx: ~250 bytes = ~250 sats
- Release tx: ~250 bytes = ~250 sats

**Negligible compared to service costs.**

---

## WhatsOnChain API

Free tier (no API key needed):
- Balance lookups
- UTXO queries
- Transaction broadcasting
- Block explorer

**Rate limits:**
- Reasonable for MVP
- Upgrade to paid tier for high-volume production

Docs: https://developers.whatsonchain.com/

---

## Known Limitations (MVP)

1. **Centralized escrow**
   - Platform controls escrow wallet
   - Requires trust
   - Future: implement HTLC or multisig

2. **Private key storage**
   - Encrypted in local SQLite database
   - Production should use HSM/KMS
   - Consider allowing external wallet signing

3. **Transaction fee calculation**
   - Fixed 1 sat/byte estimate
   - Could be more sophisticated

4. **UTXO management**
   - Basic coin selection
   - No UTXO consolidation logic

5. **Error handling**
   - Basic retry logic needed
   - Handle network failures gracefully

---

## Mainnet Checklist

Before deploying to **mainnet**:

- [ ] Set `BSV_NETWORK=mainnet` in production env
- [ ] Generate secure platform escrow wallet (cold storage)
- [ ] Store platform private key in KMS (AWS/GCP/Azure)
- [ ] Generate strong master encryption key (32+ bytes)
- [ ] Enable database encryption at rest
- [ ] Set up monitoring for escrow wallet balance
- [ ] Implement transaction confirmation checks (wait for 1+ blocks)
- [ ] Add rate limiting on API endpoints
- [ ] Set up automated backups
- [ ] Security audit of escrow logic
- [ ] Test thoroughly on testnet first
- [ ] Document disaster recovery procedures
- [ ] Set up alerts for failed transactions

---

## Future Enhancements

### Trustless Escrow

Implement **hashlock (HTLC)** for atomic swaps:
1. Buyer locks funds with hash(secret)
2. Seller can claim funds by revealing secret
3. Buyer can reclaim after timeout

### Hardware Wallet Support

Allow users to sign transactions with:
- Ledger
- Trezor
- ElectrumSV

### Fee Optimization

- Dynamic fee calculation based on network conditions
- UTXO consolidation during low-fee periods
- Batching of multiple payments

### SPV Support

- Use SPV (Simplified Payment Verification)
- Reduce dependency on third-party APIs
- Run own BSV node for high reliability

---

## Support

- **BSV SDK Docs**: https://docs.bsvblockchain.org/sdk
- **WhatsOnChain API**: https://developers.whatsonchain.com/
- **BSV Academy**: https://bitcoinsv.academy/

---

## License

MIT (see LICENSE file)
