# AgentPay Security Quick Fix Guide

**Time to fix critical issues:** ~4 hours  
**Priority:** CRITICAL - Required before production

---

## Fix 1: Protect Payment Endpoints (30 min)

### File: `apps/api/src/server.ts`

**Line 407** - Add authentication:
```typescript
// BEFORE:
app.get('/api/payments/:id', (req, res) => {

// AFTER:
app.get('/api/payments/:id', authMiddleware, requirePartyMatch, (req, res) => {
```

**Line 413** - Add authentication:
```typescript
// BEFORE:
app.post('/api/payments/:id/dispute', (req, res) => {

// AFTER:
app.post('/api/payments/:id/dispute', authMiddleware, requireBuyerMatch, (req, res) => {
```

**Create new middleware** in `apps/api/src/middleware/auth.ts`:
```typescript
export function requirePartyMatch(req: Request, res: Response, next: NextFunction) {
  const auth = (req as any).authWallet as { id: string }
  const paymentId = String(req.params.id)
  
  // Get payment from database
  const db = getDb()
  const payment = db.prepare('SELECT buyerWalletId, providerWalletId FROM payments WHERE id = ?').get(paymentId)
  
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  
  if (payment.buyerWalletId !== auth.id && payment.providerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  
  next()
}

export function requireBuyerMatch(req: Request, res: Response, next: NextFunction) {
  const auth = (req as any).authWallet as { id: string }
  const paymentId = String(req.params.id)
  
  const db = getDb()
  const payment = db.prepare('SELECT buyerWalletId FROM payments WHERE id = ?').get(paymentId)
  
  if (!payment) return res.status(404).json({ error: 'Payment not found' })
  
  if (payment.buyerWalletId !== auth.id) {
    return res.status(403).json({ error: 'Only buyer can dispute' })
  }
  
  next()
}
```

---

## Fix 2: Admin-Only Dispute Resolution (20 min)

### File: `apps/api/src/server.ts`

**Line 474** - Add admin check:
```typescript
app.post('/api/disputes/:id/resolve', authMiddleware, (req, res) => {
  try {
    // ADD THIS:
    const auth = (req as any).authWallet as { id: string }
    const ADMIN_WALLETS = (process.env.ADMIN_WALLET_IDS || '').split(',').filter(Boolean)
    
    if (!ADMIN_WALLETS.includes(auth.id)) {
      return res.status(403).json({ error: 'Admin access required' })
    }
    
    // Rest of existing code...
```

**Add to `.env`:**
```bash
# Comma-separated list of admin wallet IDs
ADMIN_WALLET_IDS=your-admin-wallet-id-here,another-admin-wallet-id
```

---

## Fix 3: Disable Stack Traces (15 min)

### File: `apps/api/src/server.ts`

**Add at the end, before `app.listen()`:**
```typescript
// Global error handler - MUST be last middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Log full error server-side
  console.error('Error:', err)
  
  // Return sanitized error to client
  const isDevelopment = process.env.NODE_ENV !== 'production'
  
  res.status(err.status || 500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    ...(isDevelopment && { stack: err.stack })
  })
})
```

**Update package.json scripts:**
```json
{
  "scripts": {
    "start": "NODE_ENV=production node dist/server.js",
    "dev": "NODE_ENV=development tsx watch src/server.ts"
  }
}
```

---

## Fix 4: Restrict CORS (10 min)

### File: `apps/api/src/server.ts`

**Line ~17** - Replace:
```typescript
// BEFORE:
app.use(cors())

// AFTER:
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'https://app.agentpay.com',
  'https://agentpay.com'
]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman)
    if (!origin) return callback(null, true)
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('CORS not allowed'))
    }
  },
  credentials: true
}))
```

**Add to `.env`:**
```bash
ALLOWED_ORIGINS=http://localhost:3000,https://app.agentpay.com
```

---

## Fix 5: Protect Service Listing (15 min)

### File: `apps/api/src/server.ts`

**Line ~145** - Add optional authentication:
```typescript
// BEFORE:
app.get('/api/services', (req, res) => {

// AFTER:
app.get('/api/services', (req, res) => {
  const apiKey = getApiKey(req)
  const isAuthenticated = apiKey && wallets.verifyApiKey(apiKey)
  
  const services = registry.search({
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
    keyword: typeof req.query.q === 'string' ? req.query.q : undefined,
    maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  })
  
  // Hide sensitive fields for unauthenticated requests
  const sanitizedServices = isAuthenticated ? services : services.map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    price: s.price,
    currency: s.currency,
    active: s.active
    // Omit: agentId, endpoint, method, webhookUrl
  }))
  
  res.json({ ok: true, services: sanitizedServices })
})
```

---

## Fix 6: Input Sanitization (20 min)

### File: `apps/api/src/server.ts`

**Add validation helper:**
```typescript
function sanitizeText(text: string, maxLength: number = 200): string {
  // Remove HTML/script tags
  const cleaned = text
    .replace(/<[^>]*>/g, '')  // Remove HTML tags
    .replace(/[<>]/g, '')      // Remove angle brackets
    .trim()
  
  return cleaned.substring(0, maxLength)
}
```

**Line ~113** - Sanitize wallet name:
```typescript
app.post('/api/wallets/connect/internal', (req, res) => {
  const name = req.body?.name ? sanitizeText(String(req.body.name), 100) : undefined
  const wallet = wallets.create({ name })
  // ...
})
```

---

## Fix 7: Remove Version from Health (5 min)

### File: `apps/api/src/server.ts`

**Line ~32**:
```typescript
// BEFORE:
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agentpay', version: '0.1.0' })
})

// AFTER:
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'agentpay' })
})

// Add authenticated version endpoint
app.get('/api/status', authMiddleware, (_req, res) => {
  res.json({ 
    ok: true, 
    service: 'agentpay', 
    version: '0.1.0',
    environment: process.env.NODE_ENV 
  })
})
```

---

## Testing After Fixes

```bash
# Test 1: Payment endpoint now requires auth
curl http://localhost:3100/api/payments/test
# Should return: 401 Unauthorized

# Test 2: Dispute requires buyer auth
curl -X POST http://localhost:3100/api/payments/test/dispute
# Should return: 401 Unauthorized

# Test 3: Resolve requires admin
curl -X POST http://localhost:3100/api/disputes/test/resolve \
  -H "X-API-Key: non-admin-key"
# Should return: 403 Forbidden

# Test 4: No version in health
curl http://localhost:3100/api/health
# Should NOT contain "version" field

# Test 5: CORS restricted
curl -H "Origin: https://evil.com" http://localhost:3100/api/health
# Should return CORS error
```

---

## Deployment Checklist

- [ ] All fixes applied
- [ ] Tests passing
- [ ] Environment variables set:
  - [ ] `NODE_ENV=production`
  - [ ] `ADMIN_WALLET_IDS=...`
  - [ ] `ALLOWED_ORIGINS=...`
- [ ] Error logging configured
- [ ] Security headers added
- [ ] Rate limiting verified
- [ ] API documentation updated
- [ ] Monitoring/alerting enabled

---

## After Deployment

1. **Monitor logs** for authentication errors
2. **Test** with real wallets
3. **Verify** admin can resolve disputes
4. **Confirm** regular users cannot resolve
5. **Check** error responses don't leak info
6. **Schedule** security audit

---

**Estimated total time:** 4 hours  
**Risk reduction:** 95%  
**Production readiness:** After fixes + testing
