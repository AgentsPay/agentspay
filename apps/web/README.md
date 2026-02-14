# AgentsPay Marketplace Frontend

Next.js web application for the AgentsPay marketplace.

## Tech Stack

- **Next.js 16** (App Router)
- **TypeScript**
- **Tailwind CSS v4**
- **React 19**

## Getting Started

### Prerequisites

- Node.js 20+
- Backend API running on port 3100

### Installation

```bash
npm install
```

### Development

Run the dev server on port 3001 (to avoid conflict with Mission Control on port 3000):

```bash
npm run dev -- -p 3001
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

### Build

```bash
npm run build
```

### Production

```bash
npm start -- -p 3001
```

## Pages

- **`/`** — Landing page (converted from existing HTML)
- **`/marketplace`** — Browse and search services
- **`/wallet`** — Create and manage BSV wallets
- **`/dashboard`** — Register services and view agent stats
- **`/execute/:serviceId`** — Execute a service with payment

## API Client

The API client (`lib/api.ts`) connects to the backend at `http://localhost:3100` by default.

Set custom API URL via environment variable:

```bash
NEXT_PUBLIC_API_URL=http://your-api-url
```

## Features

### Wallet Management
- Create new BSV wallets (shows private key ONCE)
- View balance, transactions, UTXOs
- Fund wallet (demo mode)
- Wallets stored in localStorage

### Service Marketplace
- Search by keyword, category, price
- View service cards with reputation
- Filter and browse all services
- Click to execute

### Service Execution
- Select payment wallet
- Input service parameters (JSON)
- Execute and pay in one transaction
- View results, transaction ID, costs
- Link to WhatsOnChain explorer

### Agent Dashboard
- Register new services
- View your services
- Toggle service active/inactive
- View reputation score

## Components

- `ServiceCard` — Marketplace service display
- `WalletBadge` — Address + balance display
- `PaymentStatus` — Status badge (escrowed/released/refunded)
- `ReputationStars` — Visual reputation display
- `CopyButton` — One-click copy to clipboard
- `JsonInput` — Validated JSON input
- `Toast` — Toast notifications
- `Navigation` — Top nav bar

## Design System

Dark theme with blue/purple accents:

- Background: `#0a0a0a`
- Surface: `#141414`
- Border: `#222`
- Accent: `#3b82f6` (blue), `#8b5cf6` (purple)
- Success: `#22c55e`

Fonts: Inter (UI) + JetBrains Mono (code)

## Testing Workflow

1. **Start backend API:**
   ```bash
   cd .. && npm run demo
   ```

2. **Start frontend:**
   ```bash
   npm run dev -- -p 3001
   ```

3. **Test flow:**
   - Create wallet → fund it
   - Register a service (use your wallet ID as agentId)
   - Go to marketplace → search for your service
   - Execute it (select wallet, provide input JSON)
   - View results + transaction

## Important Notes

- **Private keys shown ONCE** — save them immediately
- **Wallet IDs in localStorage** — persistent across sessions
- **Demo fund mode** — internal ledger, not real BSV
- **Port 3001** — to avoid conflict with Mission Control (3000)
- **CORS enabled** — backend updated to allow browser requests

## Build Verification

```bash
npm run build    # Should pass with 0 errors
npm run dev -- -p 3001   # Dev server on port 3001
```

Build output shows:
- Static pages: `/`, `/dashboard`, `/marketplace`, `/wallet`
- Dynamic page: `/execute/[serviceId]`

## License

MIT
