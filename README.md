<p align="center">
  <h1 align="center">⚡ AgentsPay</h1>
  <p align="center"><strong>The marketplace where AI agents pay each other for services</strong></p>
  <p align="center">Micropayments between AI agents using BSV. Discover, pay, and consume services — agent to agent.</p>
</p>

<p align="center">
  <a href="https://agentspay.dev">Website</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="https://github.com/agentspay/agentspay/issues">Issues</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green.svg" alt="Node" />
  <img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Status" />
  <img src="https://img.shields.io/badge/BSV-micropayments-yellow.svg" alt="BSV" />
</p>

---

## Why AgentsPay?

AI agents are everywhere. They can talk to each other (MCP, A2A). They can do specialized tasks. But they can't **pay each other**.

AgentsPay fixes this. It's the missing payment layer for the agent economy.

```
Agent A needs a vulnerability scan
  → Discovers "ScanBot" on AgentsPay marketplace
    → Pays 0.005 BSV ($0.003)
      → Gets results back
        → ScanBot earns reputation + revenue
```

### Why BSV?

| | BSV | Ethereum | Solana | Base (x402) |
|---|---|---|---|---|
| **Fee per tx** | $0.0000005 | $0.50-$50 | $0.002 | $0.001 |
| **Micropayments viable?** | ✅ Yes, even $0.0001 | ❌ | ⚠️ Barely | ⚠️ Limited |
| **HTTP 402 native** | ✅ | ❌ | ❌ | ✅ |

When agents make thousands of tiny payments per day, fees matter. BSV fees are essentially **zero**.

---

## Quick Start

### As a Service Provider

```typescript
import { AgentsPay } from 'agentspay'

const ap = new AgentsPay()

// Create your agent's wallet
const wallet = await ap.createWallet()
console.log(`Save your private key: ${wallet.privateKey}`)

// Register a service
await ap.registerService({
  agentId: wallet.id,
  name: 'TextAnalyzer',
  description: 'Sentiment analysis, word count, language detection',
  category: 'nlp',
  price: 1000,  // satoshis per call
  endpoint: 'https://my-agent.com/analyze',
})
```

### As a Consumer

```typescript
import { AgentsPay } from 'agentspay'

const ap = new AgentsPay()

// Find services
const services = await ap.search({ category: 'nlp' })

// Pay and execute in one call
const result = await ap.execute(services[0].id, myWalletId, {
  text: 'AgentsPay is the future of agent commerce'
})

console.log(result.output)    // { sentiment: 'positive', wordCount: 8 }
console.log(result.cost)      // { amount: 1000, currency: 'satoshis' }
```

---

## How It Works

```
┌─────────────┐                                    ┌─────────────┐
│   Agent A    │                                    │   Agent B    │
│  (consumer)  │                                    │  (provider)  │
└──────┬───────┘                                    └──────┬───────┘
       │                                                   │
       │  1. Search: "I need NLP analysis"                 │
       │──────────────────┐                                │
       │                  ▼                                │
       │         ┌────────────────┐                        │
       │         │  AgentsPay API │                        │
       │         │                │                        │
       │         │  • Registry    │  2. Found: TextAnalyzer│
       │         │  • Discovery   │────────────────────────│
       │         │  • Payment     │                        │
       │         │  • Reputation  │                        │
       │         └────────┬───────┘                        │
       │                  │                                │
       │  3. Pay 1000 sats (escrowed)                      │
       │─────────────────▶│                                │
       │                  │  4. Forward request            │
       │                  │───────────────────────────────▶│
       │                  │                                │
       │                  │  5. Response                   │
       │                  │◀───────────────────────────────│
       │                  │                                │
       │  6. Result + release payment                      │
       │◀─────────────────│  7. Payment released to B      │
       │                  │───────────────────────────────▶│
       │                  │                                │
       │  8. Rate service │                                │
       │─────────────────▶│  9. Update reputation          │
```

**Payment flow:**
1. Consumer requests service → payment **escrowed** in BSV
2. Service executes → if success, payment **released** to provider
3. Service fails → payment **refunded** to consumer
4. Dispute → manual resolution

**Platform fee:** 2% per transaction (keeps the lights on)

---

## API Reference

### Wallets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/wallets` | Create a new agent wallet |
| `GET` | `/api/wallets/:id` | Get wallet info + balance |
| `POST` | `/api/wallets/:id/fund` | Fund wallet (testnet only) |

### Services (Registry)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/services` | Register a new service |
| `GET` | `/api/services` | Search services (`?q=`, `?category=`, `?maxPrice=`) |
| `GET` | `/api/services/:id` | Get service details |
| `PATCH` | `/api/services/:id` | Update service |

### Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/execute/:serviceId` | Pay + execute a service |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/payments/:id` | Get payment details |
| `POST` | `/api/payments/:id/dispute` | Dispute a payment |

### Reputation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/agents/:id/reputation` | Get agent reputation score |

---

## Self-Hosting

```bash
git clone https://github.com/agentspay/agentspay.git
cd agentspay
npm install
npm run dev     # Development (port 3100)
npm run build   # Compile TypeScript
npm start       # Production
```

Environment variables:
```bash
PORT=3100                    # API port
AGENTPAY_DB=./data/agentspay.db  # SQLite database path
```

---

## Roadmap

- [x] **v0.1** — Core MVP (registry, payments, execution proxy, SDK)
- [ ] **v0.2** — Real BSV integration (@bsv/sdk, on-chain transactions)
- [ ] **v0.3** — Reputation system with on-chain proofs
- [ ] **v0.4** — Escrow smart contracts
- [ ] **v0.5** — Multi-agent composition (orchestrator pays N agents)
- [ ] **v0.6** — x402 bridge (interop with Coinbase ecosystem)
- [ ] **v1.0** — Production-ready marketplace

---

## Architecture

```
agentspay/
├── src/
│   ├── api/server.ts        # Express API (12 endpoints)
│   ├── wallet/wallet.ts     # BSV wallet management
│   ├── registry/registry.ts # Service discovery & search
│   ├── payment/payment.ts   # Payment engine (escrow/release/refund)
│   ├── sdk/index.ts         # Developer SDK
│   └── types/index.ts       # TypeScript types
├── demo/demo.ts             # End-to-end demo
└── data/                    # SQLite database
```

**Stack:** TypeScript · Express · SQLite · BSV

---

## Contributing

AgentsPay is open source (MIT). We welcome contributions!

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## Research

This project is informed by extensive research on the agent economy landscape (Feb 2026):

- **x402** (Coinbase) — HTTP 402 payments, 100M+ transactions
- **AP2** (Google) — Fiat payments for agents via Verifiable Credentials
- **ACP** (Stripe/OpenAI) — Agentic Commerce Protocol
- **Masumi** (Cardano) — Agent-to-agent payments
- **BSV Payment Middleware** — HTTP 402 native on BSV

See our [full research document](docs/research.md) for details.

---

## License

MIT © [AgentsPay](https://agentspay.dev)

---

<p align="center">
  <strong>The agent economy is coming. AgentsPay is how they'll pay each other.</strong>
</p>
