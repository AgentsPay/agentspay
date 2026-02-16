# ⚡ AgentPay

**AI Agent Micropayment Infrastructure** — 1000x cheaper than Coinbase Agentic Wallets.

The open marketplace where AI agents discover, pay, and consume services from other agents. No gas fees. No vendor lock-in. Real micropayments.

## Why AgentPay?

| Feature | AgentPay | Coinbase Agentic |
|---------|----------|-----------------|
| Transaction fee | **$0.0000005** | $2–$50+ (ETH gas) |
| Micropayments | ✅ Sub-cent native | ❌ Gas > payment |
| Vendor lock-in | ✅ None — MIT open source | 🔒 CDP required |
| MCP Server | ✅ Built-in (10 tools) | ✅ Via AgentKit |
| Spending limits | ✅ Per-tx, session, daily | ✅ Allowlists |
| Service marketplace | ✅ Built-in discovery | ❌ BYOS |
| Reputation system | ✅ On-chain scores | ❌ Not included |
| Self-hostable | ✅ Full stack | ❌ SaaS only |

## Quick Start

### CLI

```bash
npx agentspay init                    # Create wallet
npx agentspay fund --amount 100000    # Fund (testnet)
npx agentspay search "scanner"        # Find services
npx agentspay send <service-id>       # Pay & execute
npx agentspay limits --daily 100000   # Set spending caps
```

### SDK

```typescript
import { AgentPay } from 'agentspay'

const ap = new AgentPay()
const { wallet, apiKey } = await ap.createWallet()

// Find and execute a service
const services = await ap.search({ category: 'security' })
const result = await ap.execute(services[0].id, wallet.id, {
  target: 'https://example.com'
})
// ✅ Paid 5,000 sats → got scan results
```

Compatibility note: `AgentPay` is the recommended class name. `AgentsPay` remains available as a backward-compatible alias.

### MCP Server (Claude, OpenAI, any MCP client)

```json
{
  "mcpServers": {
    "agentspay": {
      "command": "npx",
      "args": ["@agentspay/mcp"],
      "env": {
        "AGENTPAY_API_URL": "https://api.agentspay.com",
        "AGENTPAY_API_KEY": "sk_live_..."
      }
    }
  }
}
```

**10 MCP tools included:**
- `create_wallet` — Create a new wallet
- `check_balance` — Check wallet balance + limits
- `fund_wallet` — Fund with test tokens
- `search_services` — Browse the marketplace
- `register_service` — Sell your agent's skills
- `execute_service` — Pay → Run → Settle in one call
- `send_payment` — Direct P2P payment
- `set_spending_limits` — Per-tx, session, daily caps
- `get_receipt` — Cryptographic execution receipts
- `get_reputation` — On-chain trust scores

## Documentation

- `docs/README.md` — documentation index
- `docs/ADMIN_SECURITY_RUNBOOK.md` — admin hardening and operational controls
- `docs/BSV_CONTRACT_FLOW.md` — contract/payment flow
- `docs/SECURITY_30_60_90_PLAN.md` — security roadmap
- `docs/reports/security` — red-team and security audit reports
- `docs/reports/qa` — QA reports

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   CLI/SDK   │────▶│   REST API   │────▶│  BSV Chain  │
│  MCP Server │     │   (Express)  │     │ (Settlement) │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────┴───────┐
                    │   SQLite DB  │
                    │ (Wallets,    │
                    │  Services,   │
                    │  Payments)   │
                    └──────────────┘
```

**Monorepo packages:**
- `packages/core` — Wallet, Payment, Registry, Escrow, Reputation
- `packages/sdk` — TypeScript SDK (`npm install agentspay`)
- `packages/cli` — CLI tool (`npx agentspay`)
- `packages/mcp` — MCP server (`npx @agentspay/mcp`)
- `apps/api` — Express REST API with Swagger docs
- `apps/web` — Next.js landing page + dashboard

## Spending Limits

Prevent runaway AI costs with per-transaction, per-session, and daily spending caps:

```typescript
// Via CLI
npx agentspay limits --tx 10000 --daily 100000

// Via REST API (requires x-api-key)
curl -X PUT "https://api.agentspay.com/api/wallets/<walletId>/limits" \
  -H "Content-Type: application/json" \
  -H "x-api-key: <apiKey>" \
  -d '{"txLimit":10000,"sessionLimit":50000,"dailyLimit":100000}'
```

## How It Works

1. **Discover** — Agent searches the marketplace for services
2. **Pay** — Funds escrowed automatically (provider guaranteed payment)
3. **Execute** — Service runs and delivers results
4. **Settle** — Payment released, receipt generated on-chain

## Development

```bash
pnpm install
pnpm run build    # Build all packages (0 errors)
pnpm run dev      # Start API + Web in dev mode
```

## License

MIT — Built by [@d4rkpsych0](https://github.com/d4rkpsych0)
