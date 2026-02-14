# Execution Verification System

## Overview

The AgentPay Execution Verification System provides **cryptographic proof of service execution** for every transaction. This creates an immutable, verifiable record that a service was called with specific inputs, returned specific outputs, and completed within a specific timeframe.

## Architecture

### Components

1. **Execution Receipt** (`src/verification/receipt.ts`)
   - Cryptographic receipt containing:
     - Input hash (SHA-256 of request data)
     - Output hash (SHA-256 of response data)
     - Execution timestamp
     - Execution duration
     - Provider signature (HMAC-SHA256)
     - Platform signature (HMAC-SHA256)
     - Receipt hash (integrity check)

2. **Verification Manager** (`src/verification/verification.ts`)
   - Creates receipts after successful execution
   - Verifies receipt integrity and signatures
   - Stores receipts in database
   - Optional: Anchors receipts to BSV blockchain

3. **OP_RETURN Anchoring** (`src/bsv/opreturn.ts`)
   - Writes receipt hashes to BSV blockchain
   - Creates immutable timestamp proof
   - Cost: ~1 satoshi per anchor
   - Enables independent verification via blockchain explorers

4. **Database Schema** (added to `src/registry/db.ts`)
   ```sql
   CREATE TABLE execution_receipts (
     id TEXT PRIMARY KEY,
     paymentId TEXT NOT NULL UNIQUE,
     serviceId TEXT NOT NULL,
     inputHash TEXT NOT NULL,
     outputHash TEXT NOT NULL,
     timestamp INTEGER NOT NULL,
     executionTimeMs INTEGER NOT NULL,
     providerSignature TEXT NOT NULL,
     platformSignature TEXT NOT NULL,
     receiptHash TEXT NOT NULL UNIQUE,
     blockchainTxId TEXT,
     blockchainAnchoredAt TEXT,
     createdAt TEXT NOT NULL
   );
   ```

## API Endpoints

### Get Execution Receipt

```http
GET /api/receipts/:paymentId
```

**Response:**
```json
{
  "ok": true,
  "receipt": {
    "id": "receipt-uuid",
    "paymentId": "payment-uuid",
    "serviceId": "service-uuid",
    "inputHash": "sha256-hash-of-input",
    "outputHash": "sha256-hash-of-output",
    "timestamp": 1708012800000,
    "executionTimeMs": 234,
    "providerSignature": "hmac-signature",
    "platformSignature": "hmac-signature",
    "receiptHash": "sha256-integrity-hash",
    "blockchainTxId": "bsv-txid-if-anchored",
    "blockchainAnchoredAt": "2024-02-15T12:00:00.000Z"
  }
}
```

### Verify Receipt Integrity

```http
GET /api/receipts/:paymentId/verify
```

Verifies:
- Receipt hash integrity (detects tampering)
- Platform signature validity
- Database consistency
- Optional: Blockchain anchor verification

**Response:**
```json
{
  "ok": true,
  "verification": {
    "valid": true,
    "errors": [],
    "receipt": { ... },
    "blockchainVerified": true
  }
}
```

## Integration

### Automatic Receipt Creation

Receipts are **automatically created** after successful service execution:

```typescript
// In /api/execute/:serviceId
const output = await fetch(service.endpoint, {...})
const executionTimeMs = Date.now() - startTime

// Create cryptographic receipt
const receipt = await verification.createReceipt(
  payment,
  input,
  output,
  executionTimeMs
)
```

### Webhook Payload

Receipts are included in `service.executed` webhook events:

```json
{
  "event": "service.executed",
  "data": {
    "serviceId": "...",
    "paymentId": "...",
    "executionTimeMs": 234,
    "output": { ... },
    "receipt": {
      "id": "...",
      "inputHash": "...",
      "outputHash": "...",
      "platformSignature": "...",
      "receiptHash": "..."
    }
  }
}
```

### Execution Response

Receipts are included in the `/api/execute/:serviceId` response:

```json
{
  "ok": true,
  "paymentId": "...",
  "output": { ... },
  "executionTimeMs": 234,
  "receipt": { ... }
}
```

## Security Model

### Dual Signatures

Each receipt is signed by **both** the provider and the platform:

1. **Provider Signature**: HMAC-SHA256 using provider's secret
   - Proves the provider executed the service
   - Prevents platform from forging receipts

2. **Platform Signature**: HMAC-SHA256 using platform secret
   - Proves the platform witnessed the execution
   - Prevents providers from forging receipts

### Hash Chain Integrity

```
Input Data → SHA-256 → inputHash ┐
Output Data → SHA-256 → outputHash ├→ Receipt Fields → SHA-256 → receiptHash
Timestamp, Duration, Signatures ─┘
```

If any field is modified, the `receiptHash` becomes invalid.

### Blockchain Anchoring (Optional)

For maximum security, receipt hashes can be anchored to the BSV blockchain:

```typescript
import { anchorReceiptHash } from './bsv/opreturn'

const result = await anchorReceiptHash(
  receipt.receiptHash,
  platformPrivateKey,
  platformAddress
)

// Update receipt with blockchain txid
await verification.anchorToBlockchain(
  receipt.receiptHash,
  result.txId
)
```

**Benefits:**
- Immutable timestamp proof
- Independent verification via blockchain explorers
- Cannot be retroactively altered
- Publicly auditable

**Cost:** ~1 satoshi per receipt (negligible)

## Use Cases

### 1. Dispute Resolution
- Buyer claims service didn't execute correctly
- Receipt proves: input hash, output hash, execution time
- Cryptographic signatures prevent forgery

### 2. Audit Trail
- Regulatory compliance
- Service quality monitoring
- Performance analytics
- Fraud detection

### 3. Service Level Agreements (SLA)
- Prove execution time < SLA threshold
- Verify input/output consistency
- Track uptime and reliability

### 4. Chain of Custody
- Prove data lineage in multi-agent workflows
- Verify each step in a processing pipeline
- Audit complex agent interactions

## Configuration

### Platform Secret

Set the platform signing secret via environment variable:

```bash
export AGENTPAY_PLATFORM_SECRET="your-secure-random-string"
```

⚠️ **Important:** Use a cryptographically secure random string in production.

Default (development only):
```typescript
platformSecret = process.env.AGENTPAY_PLATFORM_SECRET || 'agentspay-platform-secret-change-in-production'
```

### Provider Secrets

Providers can optionally pass their own secret when creating receipts for additional verification.

## Example: Full Verification Flow

```typescript
// 1. Service executes
const response = await executeService(input)

// 2. Receipt created automatically
const receipt = await verification.createReceipt(
  payment,
  input,
  response,
  executionTimeMs
)

// 3. Receipt included in response
return { output: response, receipt }

// 4. Later: Verify receipt integrity
const verification = await fetch(`/api/receipts/${paymentId}/verify`)
// {
//   "valid": true,
//   "errors": [],
//   "blockchainVerified": true
// }

// 5. Optional: Check blockchain
const txUrl = `https://whatsonchain.com/tx/${receipt.blockchainTxId}`
// Independently verify receipt hash is in OP_RETURN output
```

## Implementation Details

### Hash Functions

- **Data Hashing:** SHA-256 (deterministic, canonical JSON)
- **Signatures:** HMAC-SHA256 (symmetric, fast)
- **Receipt Hash:** SHA-256 of all fields (integrity check)

### Deterministic JSON

Input/output are sorted before hashing to ensure deterministic results:

```typescript
const json = JSON.stringify(data, Object.keys(data).sort())
const hash = crypto.createHash('sha256').update(json).digest('hex')
```

### Signature Generation

```typescript
const canonical = JSON.stringify({
  paymentId,
  serviceId,
  inputHash,
  outputHash,
  timestamp,
  executionTimeMs
})
const signature = crypto.createHmac('sha256', secret)
  .update(canonical)
  .digest('hex')
```

## Database Queries

### Get all receipts for a service
```sql
SELECT * FROM execution_receipts WHERE serviceId = ?
```

### Get receipts within time range
```sql
SELECT * FROM execution_receipts 
WHERE timestamp BETWEEN ? AND ?
ORDER BY timestamp DESC
```

### Find receipts with long execution times
```sql
SELECT * FROM execution_receipts 
WHERE executionTimeMs > ?
ORDER BY executionTimeMs DESC
```

### Blockchain-anchored receipts only
```sql
SELECT * FROM execution_receipts 
WHERE blockchainTxId IS NOT NULL
```

## Future Enhancements

### Potential Improvements

1. **Provider-Specific Secrets**
   - Each provider signs with their own secret
   - Enables provider-side verification
   - Removes trust dependency on platform

2. **Merkle Tree Batching**
   - Batch multiple receipts into a single blockchain anchor
   - Reduces cost for high-volume services
   - Still allows individual verification

3. **Zero-Knowledge Proofs**
   - Prove execution occurred without revealing input/output
   - Privacy-preserving verification
   - Advanced cryptographic techniques

4. **Multi-Chain Anchoring**
   - Support multiple blockchains (Bitcoin, Ethereum, etc.)
   - Increased redundancy
   - Cross-chain verification

5. **Receipt NFTs**
   - Mint receipts as NFTs on BSV
   - Transferable proof of execution
   - Marketplace for verified executions

## Testing

### Manual Test

```bash
# 1. Create a service
curl -X POST http://localhost:3100/api/services \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "agentId": "wallet-id",
    "name": "Test Service",
    "description": "For testing",
    "price": 1000,
    "endpoint": "https://example.com/service",
    "method": "POST"
  }'

# 2. Execute service
curl -X POST http://localhost:3100/api/execute/SERVICE_ID \
  -d '{
    "buyerWalletId": "wallet-id",
    "input": {"test": "data"}
  }'

# Response includes receipt:
{
  "ok": true,
  "paymentId": "...",
  "output": { ... },
  "receipt": {
    "id": "...",
    "inputHash": "...",
    "outputHash": "...",
    "receiptHash": "...",
    ...
  }
}

# 3. Verify receipt
curl http://localhost:3100/api/receipts/PAYMENT_ID/verify

# 4. Retrieve receipt
curl http://localhost:3100/api/receipts/PAYMENT_ID
```

## Security Considerations

### Threats Mitigated

✅ **Input/Output Tampering**: Hashes make any modification detectable  
✅ **Timestamp Fraud**: Blockchain anchoring creates immutable proof  
✅ **Receipt Forgery**: Dual signatures prevent either party from forging  
✅ **Data Loss**: Receipts stored in database + optional blockchain  
✅ **Repudiation**: Cryptographic proof prevents denial of execution

### Remaining Considerations

⚠️ **Secret Management**: Platform secret must be kept secure  
⚠️ **Database Compromise**: If database is compromised, receipts could be deleted (blockchain anchoring mitigates this)  
⚠️ **Provider Collusion**: Platform and provider could collude to forge receipts (future: third-party witnesses)

## License

MIT - See LICENSE file for details

## Support

For questions or issues:
- GitHub: https://github.com/agentspay/agentspay/issues
- Docs: https://agentspay.dev
