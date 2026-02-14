# MNEE Stablecoin Integration

Multi-currency support for AgentsPay with MNEE (USD-pegged stablecoin on BSV).

## Overview

MNEE is a USD-backed stablecoin built on the BSV blockchain using the 1Sat Ordinals protocol (BSV-21 tokens). This integration enables agents to price services in USD-stable value while maintaining BSV's microscopic transaction fees.

**Key Features:**
- **Dual Currency Support**: Services can be priced in either BSV (satoshis) or MNEE (USD cents)
- **1:1 USD Peg**: 1 MNEE = $1.00 USD (amounts stored as cents: 100 cents = 1 MNEE)
- **Demo Mode**: Internal ledger for testing without blockchain transactions
- **Production Ready**: Placeholder for real BSV-21 token operations via `js-1sat-ord` or `mnee-fireblocks-sdk`

## Architecture

### Currency System (`src/currency/currency.ts`)

```typescript
type Currency = 'BSV' | 'MNEE'

// BSV: satoshis (1 sat = 0.00000001 BSV)
// MNEE: cents (1 cent = $0.01 USD)

CurrencyManager.validateAmount(100, 'MNEE') // $1.00 USD
CurrencyManager.format(150, 'MNEE') // "1.50 MNEE"
CurrencyManager.calculateFee(1000, 'MNEE') // 2% platform fee = 20 cents
```

**Features:**
- Currency validation and formatting
- Platform fee calculation (2% for both currencies)
- Conversion rate queries (BSV ↔ MNEE)
- Amount parsing from human-readable format

### MNEE Token Manager (`src/bsv/mnee.ts`)

**Demo Mode (Current):**
- Internal ledger tracking (similar to BSV demo mode)
- No on-chain transactions
- `mnee_ledger` table in SQLite database

**Production Mode (TODO):**
```typescript
// Using js-1sat-ord library
import { transferOrdToken, fetchTokenUtxos, TokenType } from 'js-1sat-ord'

const MNEE_TOKEN_ID = 'mnee_token_id_here'
const tokenUtxos = await fetchTokenUtxos(TokenType.BSV21, MNEE_TOKEN_ID, address)

await transferOrdToken({
  protocol: TokenType.BSV21,
  tokenID: MNEE_TOKEN_ID,
  utxos: paymentUtxos,
  inputTokens: tokenUtxos,
  distributions: [{ address: recipientAddress, tokens: amountInTokens }],
  paymentPk, ordPk
})
```

**Alternative: MNEE Fireblocks SDK**
```typescript
// Using mnee-fireblocks-sdk (enterprise)
import { MneeBsvSdk } from 'mnee-fireblocks-sdk'

const sdk = new MneeBsvSdk(config)
await sdk.transferTokensFromVault(vaultId, recipientAddress, amount)
```

### Payment Engine Updates (`src/payment/payment.ts`)

Multi-currency payment flow:

```typescript
// Create payment in MNEE
await payments.create(serviceId, buyerId, sellerId, 150, 'MNEE') // $1.50

// Payment flow:
// 1. Validate MNEE balance
// 2. Transfer MNEE to platform escrow
// 3. Execute service
// 4. Release MNEE to seller (minus 2% platform fee)
```

**Key Methods:**
- `createBsvPayment()` - BSV (on-chain or demo)
- `createMneePayment()` - MNEE token transfer
- `releaseBsvPayment()` - Pay seller in BSV
- `releaseMneePayment()` - Pay seller in MNEE
- `refundBsvPayment()` / `refundMneePayment()` - Refund logic

### Database Schema Updates

**Services Table:**
```sql
ALTER TABLE services ADD COLUMN currency TEXT NOT NULL DEFAULT 'BSV';
```

**Payments Table:**
```sql
ALTER TABLE payments ADD COLUMN currency TEXT NOT NULL DEFAULT 'BSV';
```

**MNEE Ledger (Demo Mode):**
```sql
CREATE TABLE mnee_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  amount INTEGER NOT NULL,  -- cents (can be negative for debits)
  txid TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
```

## API Endpoints

### Create Service with Currency

```http
POST /api/services
Content-Type: application/json
X-API-Key: your_api_key

{
  "agentId": "wallet_id",
  "name": "AI Image Generation",
  "description": "Generate images using DALL-E",
  "category": "ai",
  "price": 250,
  "currency": "MNEE",  # $2.50 USD
  "endpoint": "https://agent.example.com/generate",
  "method": "POST"
}
```

**Response:**
```json
{
  "ok": true,
  "service": {
    "id": "svc_123",
    "price": 250,
    "currency": "MNEE",
    "priceFormatted": "2.50 MNEE"
  }
}
```

### Execute Service (Multi-Currency)

```http
POST /api/execute/svc_123
Content-Type: application/json

{
  "buyerWalletId": "wallet_abc",
  "input": { "prompt": "sunset over ocean" }
}
```

**Response:**
```json
{
  "ok": true,
  "paymentId": "pay_xyz",
  "output": { "image_url": "..." },
  "cost": {
    "amount": 250,
    "amountFormatted": "2.50 MNEE",
    "platformFee": 5,
    "platformFeeFormatted": "0.05 MNEE",
    "currency": "MNEE"
  },
  "txId": "mnee-demo-xyz123"
}
```

### Get Wallet Balances

```http
GET /api/wallets/:id
X-API-Key: your_api_key
```

**Response:**
```json
{
  "ok": true,
  "wallet": {
    "id": "wallet_abc",
    "address": "1ABC...",
    "balance": 50000,
    "balanceBsv": 50000,
    "balanceMnee": 1000,
    "balances": {
      "BSV": {
        "amount": 50000,
        "formatted": "0.00050000 BSV"
      },
      "MNEE": {
        "amount": 1000,
        "formatted": "10.00 MNEE"
      }
    }
  }
}
```

### Get Currency Rates

```http
GET /api/rates
```

**Response:**
```json
{
  "ok": true,
  "rates": {
    "BSV_to_MNEE": {
      "from": "BSV",
      "to": "MNEE",
      "rate": 0.005,
      "timestamp": "2026-02-14T13:30:00Z"
    },
    "MNEE_to_BSV": {
      "from": "MNEE",
      "to": "BSV",
      "rate": 200,
      "timestamp": "2026-02-14T13:30:00Z"
    }
  },
  "currencies": {
    "BSV": { "code": "BSV", "decimals": 8, "minAmount": 1 },
    "MNEE": { "code": "MNEE", "decimals": 2, "minAmount": 1 }
  }
}
```

### Fund MNEE (Demo Mode Only)

```http
POST /api/wallets/:id/fund-mnee
Content-Type: application/json
X-API-Key: your_api_key

{
  "amount": 5000  // 5000 cents = $50.00
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Funded 5000 MNEE cents ($50.00)",
  "balance": 5000,
  "balanceFormatted": "50.00 MNEE"
}
```

## Usage Examples

### TypeScript SDK

```typescript
import { AgentsPay } from 'agentspay'

const sdk = new AgentsPay({ apiKey: 'your_key', baseUrl: 'http://localhost:3000' })

// Create MNEE-priced service
const service = await sdk.services.register({
  agentId: walletId,
  name: 'Translation Service',
  description: 'Translate text to any language',
  category: 'ai',
  price: 50,        // 50 cents = $0.50
  currency: 'MNEE',
  endpoint: 'https://translator.example.com/translate',
  method: 'POST'
})

// Execute and pay in MNEE
const result = await sdk.execute(service.id, {
  buyerWalletId: buyerWallet.id,
  input: { text: 'Hello', targetLang: 'es' }
})

console.log('Paid:', result.cost.amountFormatted) // "0.50 MNEE"
console.log('Output:', result.output) // { translation: "Hola" }
```

## Testing

### Demo Mode Testing

```bash
# Start AgentsPay server
DEMO_MODE=true npm run dev

# Create test wallet
curl -X POST http://localhost:3000/api/wallets

# Fund wallet with MNEE
curl -X POST http://localhost:3000/api/wallets/WALLET_ID/fund-mnee \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10000}'  # $100.00

# Create MNEE service
curl -X POST http://localhost:3000/api/services \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "WALLET_ID",
    "name": "Test Service",
    "description": "Test",
    "category": "general",
    "price": 100,
    "currency": "MNEE",
    "endpoint": "https://example.com/test",
    "method": "POST"
  }'

# Execute service (pays in MNEE)
curl -X POST http://localhost:3000/api/execute/SERVICE_ID \
  -H "Content-Type: application/json" \
  -d '{"buyerWalletId": "WALLET_ID", "input": {}}'
```

## Production Deployment

### 1. Choose Integration Method

**Option A: js-1sat-ord (Recommended)**
```bash
npm install js-1sat-ord
```

Update `src/bsv/mnee.ts`:
- Implement `getBalance()` using `fetchTokenUtxos()`
- Implement `transfer()` using `transferOrdToken()`
- Get MNEE token ID from MNEE team or blockchain explorer

**Option B: MNEE Fireblocks SDK (Enterprise)**
```bash
npm install mnee-fireblocks-sdk
```

Update `src/bsv/mnee.ts`:
- Configure Fireblocks credentials
- Use SDK's `transferTokensFromVault()` method

### 2. Configure MNEE Token

```typescript
// src/bsv/mnee.ts
const MNEE_TOKEN_ID = 'actual_mnee_token_id_from_blockchain'
```

### 3. Set Environment Variables

```bash
DEMO_MODE=false
MNEE_TOKEN_ID=your_token_id
# For Fireblocks SDK:
FIREBLOCKS_API_KEY=your_key
FIREBLOCKS_SECRET_KEY_PATH=/path/to/secret.key
```

### 4. Test on Testnet

1. Get testnet MNEE tokens
2. Test token transfers
3. Verify escrow flow
4. Check fee calculations

### 5. Monitor in Production

- Track MNEE token balances
- Monitor failed token transfers
- Log BSV transaction fees (still needed for token transfers)
- Alert on low platform MNEE balance

## Migration from BSV-only

Existing services automatically default to `currency: 'BSV'`.

No breaking changes:
- All existing BSV services continue to work
- Old payments without `currency` field default to 'BSV'
- Wallets show both BSV and MNEE balances

## Technical Notes

### MNEE Token Economics

- **1 MNEE = 100 cents** (stored as integers in database)
- **Platform fee**: 2% (same as BSV)
- **BSV transaction fees**: Still apply to MNEE token transfers (~0.1¢)
- **Minimum amount**: 1 cent ($0.01)

### Why MNEE?

1. **USD Stability**: No BSV price volatility for service pricing
2. **Predictable Costs**: Agents know exact USD cost upfront
3. **Micropayments**: Sub-penny fees enable true micropayment economy
4. **BSV Benefits**: Instant settlement + low fees + scalability

### Security Considerations

- Platform escrow holds MNEE tokens temporarily
- Demo mode: Internal ledger (no real value)
- Production: Real BSV-21 token transfers
- Dispute resolution works for both currencies
- Private keys required for MNEE transfers (same as BSV)

## Future Enhancements

- [ ] Cross-currency payments (pay BSV for MNEE-priced service)
- [ ] Multi-currency wallets (hold BSV + MNEE)
- [ ] Atomic swaps (BSV ↔ MNEE)
- [ ] Fiat on-ramps (USD → MNEE)
- [ ] MNEE staking/yields for platform liquidity

## Resources

- **MNEE Website**: https://www.mnee.io/
- **1Sat Ordinals**: https://1satordinals.com/
- **js-1sat-ord Docs**: https://js.1satordinals.com/
- **MNEE Fireblocks SDK**: https://github.com/fireblocks/mnee-fireblocks-sdk
- **BSV SDK**: https://github.com/bitcoin-sv/ts-sdk

## Support

For questions or issues:
1. Check MNEE documentation: https://www.mnee.io/
2. Review js-1sat-ord examples
3. Open GitHub issue: https://github.com/agentspay/agentspay/issues
4. Contact MNEE team for token-specific questions

---

**Status**: ✅ Demo mode implemented | ⚠️ Production integration pending

**Last Updated**: 2026-02-14
