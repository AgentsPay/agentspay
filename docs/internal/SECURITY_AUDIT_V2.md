# AgentPay – Security Audit V2 (hands-on)

Date: 2026-02-14  (Europe/Madrid)
Target: `src/api/server.ts` running locally at `http://localhost:3100`
Mode: `AGENTPAY_DEMO=true`

## Summary

**Pre-fix critical issues found (and fixed):**
- **No authentication / IDOR** on wallet resources (`GET /api/wallets/:id`) allowed any caller to read other wallets.
- **SSRF**: services could be registered with internal/loopback/metadata endpoints; `POST /api/execute/:serviceId` would `fetch()` them.
- **Info disclosure**: invalid JSON bodies returned full Express stack traces (HTML error page).
- **PaymentEngine** accepted non-positive amounts (missing validation).
- **No rate limiting**.

All above are addressed in this V2 patch (see “Fixes applied”).

---

## Tests executed (real HTTP)

> Unless stated otherwise, all requests were run from PowerShell on the same host.

### Auth tests

1) `GET http://localhost:3100/api/wallets` (no API key)
- **Result:** **404** (route not implemented)
- **Note:** Spec asked for auth failure; endpoint does not exist in this API.

2) `POST http://localhost:3100/api/wallets/connect/internal`
- **Result:** **200**
- **Response includes:** `wallet.id`, `apiKey`, `privateKey` (privateKey is creation-only)

3) `GET http://localhost:3100/api/wallets/{id}` with **wrong** API key
- **Result:** **401** `{ "error": "Invalid API key" }`

4) `GET http://localhost:3100/api/wallets/{id}` with **correct** API key
- **Result:** **200**
- **Verified:** response **does not** contain `privateKey`.

### IDOR tests

Created Wallet A + Wallet B (distinct API keys) via `/api/wallets/connect/internal`.

- `GET /api/wallets/{walletA}` with Wallet B API key
  - **Result:** **403** `{ "error": "Forbidden" }`

### Input validation tests

All service writes require wallet auth and must match `agentId`.

1) SQLi-like name: `"'; DROP TABLE services;--"`
- `POST /api/services` (valid endpoint/price)
- **Result:** **200** (accepted as plain string)
- **Assessment:** OK (SQLite uses parameterized inserts; no SQL execution).

2) XSS in description: `<script>alert(1)</script>`
- `POST /api/services`
- **Result:** **400** `{ "error": "Invalid description" }`

3) Price validation
- `price = -1` → **400** `{ "error": "Invalid price" }`
- `price = 0` → **400** `{ "error": "Invalid price" }`
- `price = 999999999999` → **400** `{ "error": "Invalid price" }`

4) Fund wallet with negative amount
- `POST /api/wallets/{id}/fund` with `amount=-5`
- **Result:** **400** `{ "error": "Invalid amount" }`

### SSRF tests

Attempted to register services with unsafe endpoints:

- `endpoint=http://localhost:22` → **400**
- `endpoint=http://169.254.169.254/latest/meta-data` → **400**
- `endpoint=http://127.0.0.1:3100/api/wallets` → **400**

### Payment security tests

- Direct calls to release/refund endpoints:
  - `POST /api/payments/1/release` → **404**
  - `POST /api/payments/1/refund` → **404**

- Payment with `amount=0` / `amount=-1`
  - Not directly exposed as a public API parameter; fixed defensively in `PaymentEngine.create()` so non-positive amounts now throw `Invalid amount`.

### Rate limiting

- Sent **110** rapid requests to `GET /api/health`
- **Observed:** **200:82**, **429:28** (429 returned once the per-minute limit was exceeded)

### Info disclosure

1) Invalid JSON body
- `POST /api/services` with body `{badjson`
- **Result:** **400** `{ "error": "Invalid JSON" }`
- **Verified:** no stack trace / file paths in response.

2) Private keys in GET responses
- `GET /api/wallets/{id}` (authorized) returns only `id/publicKey/address/createdAt/balance`.

---

## Fixes applied (code)

### 1) Wallet API keys + auth middleware
- Added API key generation & SHA-256 storage (`wallets.apiKeyHash`).
- New endpoint: `POST /api/wallets/connect/internal` returning `{ wallet, apiKey, privateKey }`.
- Protected wallet endpoints:
  - `GET /api/wallets/:id` now requires API key and wallet match.
  - `/utxos`, `/transactions`, `/fund` now require API key.

### 2) SSRF protection
- Added `validateServiceEndpoint()` enforcing:
  - http/https only
  - blocks `localhost`, `0.0.0.0`, `169.254.169.254`
  - blocks private/loopback IPs
  - allows ports **80/443** only
- Applied at service registration and before execution.

### 3) Input validation
- Service validation:
  - `name` length
  - `description` length and blocks `<script>`
  - `price` must be integer in `(0..100000000]`

### 4) Payment amount validation
- `PaymentEngine.create()` now rejects non-positive amounts.

### 5) Rate limiting
- Added `express-rate-limit` on `/api` (`limit=100` per 60s).

### 6) Error handling
- Added JSON parse error handler to return `{error:"Invalid JSON"}` without stack traces.

---

## Remaining notes / recommendations

- Current endpoint allowlist for service execution ports is strict (**80/443** only). If local/internal agent endpoints are required for development, add an explicit opt-in (e.g., `AGENTPAY_ALLOW_UNSAFE_ENDPOINTS=true`) rather than relaxing by default.
- Consider requiring auth for `GET /api/payments/:id` (could leak payment metadata).
- Consider returning `privateKey` only when explicitly requested and only in demo mode.
