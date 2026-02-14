# Wallet Connect Integration

AgentPay now supports external BSV wallet connections, allowing users to connect their HandCash or Yours Wallet without sharing private keys with the platform.

## Overview

### Supported Wallet Types

1. **Internal Wallet** (Legacy/Dev)
   - Private key stored on server (encrypted)
   - Recommended for development and server-side agents only
   - Original AgentPay wallet method

2. **HandCash Connect** (Recommended for users)
   - OAuth integration with HandCash app
   - Users authorize AgentPay in their HandCash app
   - Payments are approved in HandCash app
   - Private keys never leave HandCash

3. **Yours Wallet** (Browser extension)
   - Integrates with Yours Wallet browser extension
   - Transactions signed client-side in browser
   - We only receive signed transactions for broadcast
   - Private keys never leave the extension

## Architecture

### Provider Pattern

All wallet types implement the `WalletProvider` interface:

```typescript
interface WalletProvider {
  type: 'internal' | 'handcash' | 'yours'
  connect(params?: any): Promise<WalletConnection>
  getBalance(walletId: string): Promise<number>
  signTransaction(walletId: string, tx: TransactionRequest): Promise<SignedTransaction>
  getAddress(walletId: string): Promise<string>
  disconnect(walletId: string): Promise<void>
}
```

### Files Structure

```
src/wallet/
├── wallet.ts              # Legacy WalletManager (still works)
├── providerManager.ts     # New provider coordinator
└── providers/
    ├── types.ts           # Shared interfaces
    ├── internal.ts        # Internal wallet (refactored from wallet.ts)
    ├── handcash.ts        # HandCash Connect integration
    └── yours.ts           # Yours Wallet integration
```

## API Endpoints

### List Available Providers

```http
GET /api/wallets/providers
```

Response:
```json
{
  "ok": true,
  "providers": [
    {
      "type": "internal",
      "name": "Internal Wallet",
      "description": "Private key stored on server (encrypted). For development only."
    },
    {
      "type": "handcash",
      "name": "HandCash",
      "description": "Connect your HandCash wallet. Private keys never leave HandCash."
    },
    {
      "type": "yours",
      "name": "Yours Wallet",
      "description": "Use Yours Wallet browser extension. Sign transactions locally."
    }
  ]
}
```

### Get Wallet Provider Info

```http
GET /api/wallets/:id/provider
```

Response:
```json
{
  "ok": true,
  "wallet": {
    "id": "uuid",
    "address": "1ABC...",
    "publicKey": "...",
    "createdAt": "2026-02-14T12:00:00.000Z"
  },
  "provider": {
    "walletId": "uuid",
    "providerType": "handcash",
    "providerData": "{\"paymail\":\"user@handcash.io\"}",
    "createdAt": "2026-02-14T12:00:00.000Z",
    "lastUsed": "2026-02-14T13:00:00.000Z"
  },
  "balance": 100000
}
```

### HandCash Integration

#### 1. Get Authorization URL

```http
GET /api/wallets/connect/handcash
```

Response:
```json
{
  "ok": true,
  "authUrl": "https://app.handcash.io/authorizeApp/..."
}
```

#### 2. Redirect User to HandCash

User authorizes AgentPay in their HandCash app. HandCash redirects back to:

```
GET /api/wallets/connect/handcash/callback?authToken=xxx
```

This endpoint creates the wallet and redirects to frontend:

```
http://localhost:3000/wallet/:walletId?provider=handcash&success=true
```

#### 3. Manual Connect (for API clients)

```http
POST /api/wallets/connect/handcash
Content-Type: application/json

{
  "authToken": "xxx"
}
```

Response:
```json
{
  "ok": true,
  "connection": {
    "walletId": "uuid",
    "address": "user@handcash.io",
    "paymail": "user@handcash.io",
    "displayName": "Alice",
    "providerType": "handcash"
  }
}
```

### Yours Wallet Integration

#### 1. Connect Yours Wallet

Client-side code detects browser extension:

```javascript
// Check if Yours Wallet is installed
if (window.yours || window.panda) {
  const wallet = window.yours || window.panda
  
  // Request connection
  const { address, publicKey } = await wallet.connect()
  
  // Register with AgentPay
  const response = await fetch('/api/wallets/connect/yours', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, publicKey })
  })
}
```

Server endpoint:

```http
POST /api/wallets/connect/yours
Content-Type: application/json

{
  "address": "1ABC...",
  "publicKey": "02..."
}
```

Response:
```json
{
  "ok": true,
  "connection": {
    "walletId": "uuid",
    "address": "1ABC...",
    "publicKey": "02...",
    "displayName": "Yours Wallet",
    "providerType": "yours"
  }
}
```

#### 2. Sign Transaction Client-Side

```javascript
// When making a payment, build transaction client-side
const tx = await window.yours.signTransaction({
  recipients: [
    { address: '1XYZ...', amount: 10000 }
  ]
})

// Submit signed transaction to AgentPay
const response = await fetch(`/api/wallets/${walletId}/submit-signed`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    txHex: tx.txHex,
    txId: tx.txId
  })
})
```

Server broadcasts the signed transaction:

```http
POST /api/wallets/:id/submit-signed
Content-Type: application/json

{
  "txHex": "0100000001...",
  "txId": "abc123..."
}
```

Response:
```json
{
  "ok": true,
  "txId": "abc123...",
  "broadcasted": true
}
```

### Internal Wallet (Legacy)

```http
POST /api/wallets/connect/internal
Content-Type: application/json

{
  "privateKeyWif": "L..."  // Optional - generates new key if omitted
}
```

Response:
```json
{
  "ok": true,
  "connection": {
    "walletId": "uuid",
    "address": "1ABC...",
    "publicKey": "02...",
    "providerType": "internal"
  }
}
```

### Disconnect Wallet

```http
POST /api/wallets/:id/disconnect
```

Response:
```json
{
  "ok": true,
  "disconnected": true
}
```

## Configuration

### Environment Variables

```bash
# HandCash Connect credentials
HANDCASH_APP_ID=your-app-id
HANDCASH_APP_SECRET=your-app-secret
HANDCASH_REDIRECT_URL=http://localhost:3100/api/wallets/connect/handcash/callback

# Frontend URL (for OAuth callbacks)
FRONTEND_URL=http://localhost:3000

# Demo mode (uses mock providers, no real HandCash API calls)
AGENTPAY_DEMO=true
```

### HandCash App Registration

1. Go to https://dashboard.handcash.io
2. Create a new app
3. Set OAuth callback URL to: `http://localhost:3100/api/wallets/connect/handcash/callback`
4. Copy App ID and App Secret to `.env`

## Demo Mode

When `AGENTPAY_DEMO=true`:

- **HandCash**: Returns mock auth URL and creates mock wallet with fake paymail
- **Yours**: Works normally (client-side detection)
- **Internal**: Works normally with encrypted storage

This allows testing the integration flow without requiring real HandCash credentials or blockchain transactions.

## Security Model

### Private Keys

| Provider | Private Key Location | Security Level |
|----------|---------------------|----------------|
| Internal | Server (encrypted) | ⚠️ Lower - server compromise = key loss |
| HandCash | HandCash servers | ✅ High - we never see the key |
| Yours | Browser extension | ✅ High - we never see the key |

### Transaction Signing

| Provider | Signing Location | User Approval |
|----------|-----------------|---------------|
| Internal | Server | None (automatic) |
| HandCash | HandCash app | Required in app |
| Yours | Browser extension | Required in extension |

### Recommended Usage

- **End users**: HandCash or Yours Wallet
- **Server-side agents**: Internal wallet (if necessary)
- **Development/testing**: Any (demo mode supported)

## Database Schema

### `wallet_providers` Table

```sql
CREATE TABLE wallet_providers (
  walletId TEXT PRIMARY KEY,
  providerType TEXT NOT NULL,  -- 'internal' | 'handcash' | 'yours'
  providerData TEXT NOT NULL,  -- JSON-encoded provider-specific data
  createdAt TEXT NOT NULL,
  lastUsed TEXT
)
```

### Provider Data Format

**HandCash**:
```json
{
  "authToken": "xxx",
  "paymail": "user@handcash.io",
  "displayName": "Alice",
  "handle": "alice"
}
```

**Yours**:
```json
{
  "publicKey": "02..."
}
```

**Internal**:
```json
{}
```

## Frontend Integration Example

### React Component

```tsx
import { useState } from 'react'

function WalletConnect() {
  const [walletId, setWalletId] = useState(null)

  // HandCash
  const connectHandCash = async () => {
    const res = await fetch('/api/wallets/connect/handcash')
    const { authUrl } = await res.json()
    window.location.href = authUrl // Redirect to HandCash
  }

  // Yours Wallet
  const connectYours = async () => {
    if (!window.yours && !window.panda) {
      alert('Yours Wallet extension not installed')
      return
    }

    const wallet = window.yours || window.panda
    const { address, publicKey } = await wallet.connect()

    const res = await fetch('/api/wallets/connect/yours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, publicKey })
    })

    const { connection } = await res.json()
    setWalletId(connection.walletId)
  }

  // Internal (Advanced)
  const connectInternal = async () => {
    const res = await fetch('/api/wallets/connect/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })

    const { connection } = await res.json()
    setWalletId(connection.walletId)
  }

  return (
    <div>
      <h2>Connect Your Wallet</h2>
      <button onClick={connectHandCash}>Connect HandCash</button>
      <button onClick={connectYours}>Connect Yours Wallet</button>
      <details>
        <summary>Advanced: Import Private Key</summary>
        <button onClick={connectInternal}>Generate Internal Wallet</button>
      </details>
    </div>
  )
}
```

## Testing

### Manual Test Flow

1. **List providers**:
   ```bash
   curl http://localhost:3100/api/wallets/providers
   ```

2. **Connect internal wallet** (demo):
   ```bash
   curl -X POST http://localhost:3100/api/wallets/connect/internal \
     -H "Content-Type: application/json" \
     -d '{}'
   ```

3. **Get wallet info**:
   ```bash
   curl http://localhost:3100/api/wallets/:walletId/provider
   ```

4. **Connect HandCash** (demo mode):
   ```bash
   curl -X POST http://localhost:3100/api/wallets/connect/handcash \
     -H "Content-Type: application/json" \
     -d '{"authToken":"demo-token"}'
   ```

## Migration Guide

### From Legacy Wallet to Provider System

The old `WalletManager` API still works for backward compatibility:

```typescript
// Old way (still works)
const wallet = new WalletManager().create()

// New way (recommended)
const providerManager = getProviderManager()
const connection = await providerManager.connect('internal')
```

Existing wallets created with `WalletManager.create()` are automatically treated as `internal` provider wallets.

## Next Steps

### Future Enhancements

1. **Money Button** integration
2. **Twetch** wallet support  
3. **RelayX** integration
4. **Multi-signature** wallet support
5. **Hardware wallet** integration (Ledger, Trezor)

### Frontend UI

A complete frontend UI should be built in the `web/` directory to provide:

- Wallet connection modal with provider selection
- Provider-specific badge/indicator
- Transaction signing UI for Yours wallet
- HandCash OAuth flow handling
- Wallet management page

See `/web/README.md` (to be created) for frontend implementation guide.

## Support

For issues or questions:

- **GitHub Issues**: https://github.com/agentspay/agentspay/issues
- **Documentation**: https://agentspay.dev/docs
- **Discord**: https://discord.gg/agentspay

## License

MIT
