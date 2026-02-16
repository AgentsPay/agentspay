# Admin Security Runbook

## Purpose
Operational runbook for secure admin access, key rotation, audit review, and dispute resolution in AgentPay.

## 1. Admin Auth Modes

### Layer 1 (mandatory)
- Header: `X-Admin-Key`
- Accepted keys:
  - `AGENTPAY_MASTER_KEY_CURRENT`
  - `AGENTPAY_MASTER_KEY_PREVIOUS`
  - `AGENTPAY_MASTER_KEY` (legacy fallback)

### Layer 2 (optional step-up)
- Enabled with: `ADMIN_WALLET_2FA_REQUIRED=true`
- Allowlist: `ADMIN_WALLET_ADDRESSES` (comma-separated BSV addresses)
- Session token header after verification: `X-Admin-Wallet-Token`

## 2. Wallet Step-Up Flow

1. Request challenge:
```http
POST /api/admin/auth/challenge
X-Admin-Key: <key>
Content-Type: application/json

{ "address": "<optional-allowlisted-address>" }
```

2. Sign the returned `challenge` string with wallet (BSM-compatible signature, base64 compact).

3. Verify challenge:
```http
POST /api/admin/auth/verify
X-Admin-Key: <key>
Content-Type: application/json

{
  "nonce": "<nonce>",
  "address": "<allowlisted-address>",
  "signature": "<base64-compact-signature>"
}
```

4. Use returned `token` in admin calls:
```http
X-Admin-Wallet-Token: <token>
```

## 3. Key Rotation Procedure

1. Generate new key.
2. Set:
   - `AGENTPAY_MASTER_KEY_CURRENT=<new>`
   - `AGENTPAY_MASTER_KEY_PREVIOUS=<old>`
3. Deploy.
4. Validate:
```http
GET /api/admin/key-rotation/validate
X-Admin-Key: <new>
```
5. After grace window, remove old key from `PREVIOUS`.
6. Remove legacy `AGENTPAY_MASTER_KEY` once migration complete.

## 4. Dispute Operations

### List disputes
```http
GET /api/admin/disputes?status=open
X-Admin-Key: <key>
X-Admin-Wallet-Token: <token-if-required>
```

### Resolve dispute
```http
POST /api/admin/disputes/:id/resolve
X-Admin-Key: <key>
X-Admin-Wallet-Token: <token-if-required>
Content-Type: application/json

{ "resolution": "refund" }
```

Notes:
- `refund` and `release` execute real settlement.
- `split` is intentionally blocked until fully implemented.

## 5. Audit and Metrics

### Audit log
```http
GET /api/admin/audit-logs?action=admin.disputes.resolve&status=error&limit=100
X-Admin-Key: <key>
X-Admin-Wallet-Token: <token-if-required>
```

### Metrics
```http
GET /api/admin/metrics
X-Admin-Key: <key>
X-Admin-Wallet-Token: <token-if-required>
```

## 6. Emergency Access Revocation

Revoke current wallet session token:
```http
POST /api/admin/auth/revoke
X-Admin-Key: <key>
X-Admin-Wallet-Token: <token>
```

If key compromise is suspected:
1. Rotate `CURRENT` immediately.
2. Remove compromised key from all env vars.
3. Invalidate active sessions (manual DB update or restart with revoked sessions script).
4. Review `admin_audit_logs` for suspicious activity.
