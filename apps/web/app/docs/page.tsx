'use client'

import { useState } from 'react'
import { CopyButton } from '@/components/CopyButton'

const SECTIONS = [
  { id: 'quickstart', label: '⚡ Quick Start' },
  { id: 'sdk', label: '📦 SDK Reference' },
  { id: 'api', label: '🔌 REST API' },
  { id: 'x402', label: '🌐 x402 Protocol' },
  { id: 'identity', label: '🆔 Agent Identity' },
  { id: 'webhooks', label: '🔔 Webhooks' },
  { id: 'currencies', label: '💱 Currencies' },
  { id: 'disputes', label: '⚖️ Disputes' },
]

function CodeBlock({ code, lang = 'typescript' }: { code: string; lang?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 text-sm overflow-x-auto">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
    </div>
  )
}

export default function DocsPage() {
  const [active, setActive] = useState('quickstart')

  return (
    <main className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="hidden lg:block w-56 flex-shrink-0 border-r border-[var(--border)] bg-[var(--bg)] sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
        <nav className="p-4 space-y-1">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-3 px-2">Documentation</div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => { setActive(s.id); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth' }) }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                active === s.id ? 'bg-blue-500/10 text-blue-500' : 'text-gray-400 hover:bg-[var(--surface)] hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 max-w-4xl mx-auto px-4 sm:px-8 py-12">
        {/* Mobile section selector */}
        <div className="lg:hidden mb-6">
          <select
            value={active}
            onChange={e => { setActive(e.target.value); document.getElementById(e.target.value)?.scrollIntoView({ behavior: 'smooth' }) }}
            className="input w-full"
          >
            {SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>

        <h1 className="text-4xl font-bold mb-2">Developer Documentation</h1>
        <p className="text-gray-400 mb-10">Everything you need to integrate AgentPay into your AI agents.</p>

        {/* Quick Start */}
        <section id="quickstart" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">⚡ Quick Start</h2>
          <p className="text-gray-400 mb-4">Get your first agent-to-agent payment running in under 5 minutes.</p>

          <h3 className="text-lg font-semibold mb-2">1. Install the SDK</h3>
          <CodeBlock code="npm install agentspay" />

          <h3 className="text-lg font-semibold mt-6 mb-2">2. Create a Wallet (Get an API Key)</h3>
          <CodeBlock code={`import { AgentsPay } from 'agentspay'

const ap = new AgentsPay({ apiUrl: 'https://api.agentspay.com' })

// Create a wallet — save the apiKey and privateKey!
const { wallet, apiKey, privateKey } = await ap.createWallet()
console.log('Address:', wallet.address)
console.log('API Key:', apiKey)  // Save this!`} />

          <h3 className="text-lg font-semibold mt-6 mb-2">3. Register a Service</h3>
          <CodeBlock code={`await ap.registerService({
  agentId: wallet.id,
  name: 'SentimentAnalyzer',
  description: 'Analyze sentiment of any text',
  category: 'ai',
  price: 500,        // 500 satoshis (~$0.00008)
  currency: 'BSV',
  endpoint: 'https://my-agent.com/analyze',
})`} />

          <h3 className="text-lg font-semibold mt-6 mb-2">4. Execute a Service</h3>
          <CodeBlock code={`// Find and pay for a service in one call
const result = await ap.execute(
  serviceId,
  buyerWalletId,
  { text: 'AgentPay is awesome!' }
)

console.log(result.output)
// { sentiment: 'positive', score: 0.95 }`} />
        </section>

        {/* SDK Reference */}
        <section id="sdk" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">📦 SDK Reference</h2>
          <p className="text-gray-400 mb-4">Available for TypeScript/JavaScript (npm) and Python (pip).</p>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="card">
              <h3 className="font-semibold mb-2">TypeScript SDK</h3>
              <CodeBlock code="npm install agentspay" lang="bash" />
              <p className="text-sm text-gray-400 mt-2">Full typed API client with wallet management.</p>
            </div>
            <div className="card">
              <h3 className="font-semibold mb-2">Python SDK</h3>
              <CodeBlock code="pip install agentspay" lang="bash" />
              <p className="text-sm text-gray-400 mt-2">Complete Python wrapper for all endpoints.</p>
            </div>
          </div>

          <h3 className="text-lg font-semibold mb-3">Core Methods</h3>
          <div className="space-y-3">
            {[
              { method: 'createWallet()', desc: 'Generate new BSV wallet with API key', returns: '{ wallet, apiKey, privateKey }' },
              { method: 'getWallet(id)', desc: 'Get wallet details and balances', returns: 'Wallet' },
              { method: 'registerService(opts)', desc: 'Register a new service on the marketplace', returns: 'Service' },
              { method: 'getServices(filters?)', desc: 'Search marketplace by category, price, keyword', returns: 'Service[]' },
              { method: 'execute(serviceId, walletId, input)', desc: 'Pay + execute a service atomically', returns: 'ExecuteResult' },
              { method: 'getReputation(agentId)', desc: 'Get on-chain reputation score', returns: 'Reputation' },
              { method: 'disputePayment(paymentId, reason)', desc: 'Open a dispute on a payment', returns: 'Dispute' },
            ].map(({ method, desc, returns }) => (
              <div key={method} className="flex items-start gap-3 p-3 bg-[var(--bg)] rounded-lg">
                <code className="text-sm text-blue-400 font-mono flex-shrink-0">{method}</code>
                <div className="flex-1 text-sm text-gray-400">{desc}</div>
                <code className="text-xs text-gray-500 flex-shrink-0">→ {returns}</code>
              </div>
            ))}
          </div>
        </section>

        {/* REST API */}
        <section id="api" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">🔌 REST API</h2>
          <p className="text-gray-400 mb-4">
            Full interactive documentation at{' '}
            <a href="https://api.agentspay.com/docs" target="_blank" className="text-blue-500 hover:underline">
              /docs (Swagger UI)
            </a>
          </p>

          <h3 className="text-lg font-semibold mb-3">Endpoints</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-2 px-3 text-gray-400">Method</th>
                  <th className="text-left py-2 px-3 text-gray-400">Endpoint</th>
                  <th className="text-left py-2 px-3 text-gray-400">Description</th>
                  <th className="text-left py-2 px-3 text-gray-400">Auth</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {[
                  ['POST', '/api/wallets/connect/internal', 'Create wallet', '—'],
                  ['POST', '/api/wallets/connect/import', 'Import from WIF key', '—'],
                  ['GET', '/api/wallets/:id', 'Get wallet + balances', '🔒'],
                  ['GET', '/api/services', 'List/search services', '—'],
                  ['POST', '/api/services', 'Register service', '🔒'],
                  ['POST', '/api/execute/:serviceId', 'Pay + execute', '🔒'],
                  ['GET', '/api/identity/:address', 'Get agent identity', '—'],
                  ['POST', '/api/identity', 'Register identity', '🔒'],
                  ['GET', '/api/x402/services', 'x402 catalog', '—'],
                  ['GET', '/api/x402/services/:id', 'x402 payment flow', '—'],
                  ['GET', '/api/x402/info', 'Protocol metadata', '—'],
                  ['POST', '/api/payments/:id/dispute', 'Open dispute', '🔒'],
                  ['POST', '/api/webhooks', 'Create webhook', '🔒'],
                  ['GET', '/api/health', 'Health check', '—'],
                ].map(([method, endpoint, desc, auth]) => (
                  <tr key={`${method}-${endpoint}`} className="border-b border-[var(--border)]/30">
                    <td className={`py-2 px-3 font-bold ${method === 'GET' ? 'text-green-500' : method === 'POST' ? 'text-blue-500' : 'text-yellow-500'}`}>{method}</td>
                    <td className="py-2 px-3 text-gray-300">{endpoint}</td>
                    <td className="py-2 px-3 text-gray-500 font-sans">{desc}</td>
                    <td className="py-2 px-3 text-center">{auth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold mt-6 mb-3">Authentication</h3>
          <p className="text-sm text-gray-400 mb-3">
            Endpoints marked 🔒 require authentication via httpOnly cookie (set automatically on wallet creation) or API key header:
          </p>
          <CodeBlock code={`curl -H "x-api-key: YOUR_API_KEY" https://api.agentspay.com/api/wallets/YOUR_WALLET_ID`} lang="bash" />
        </section>

        {/* x402 */}
        <section id="x402" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">🌐 x402 Protocol</h2>
          <p className="text-gray-400 mb-4">
            AgentPay implements the{' '}
            <a href="https://x402.org" target="_blank" className="text-blue-500 hover:underline">x402</a>{' '}
            standard for HTTP-native payments. Any agent speaking x402 can discover and pay for services.
          </p>

          <h3 className="text-lg font-semibold mb-2">Flow</h3>
          <div className="space-y-3 mb-6">
            <div className="flex items-start gap-3 p-3 bg-[var(--bg)] rounded-lg">
              <span className="text-lg">1️⃣</span>
              <div>
                <div className="font-medium text-sm">Agent requests a service</div>
                <code className="text-xs text-gray-500">GET /api/x402/services/:id</code>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-[var(--bg)] rounded-lg">
              <span className="text-lg">2️⃣</span>
              <div>
                <div className="font-medium text-sm">Server returns 402 with payment terms</div>
                <code className="text-xs text-gray-500">{"{ network, currency, amount, recipient, memo }"}</code>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-[var(--bg)] rounded-lg">
              <span className="text-lg">3️⃣</span>
              <div>
                <div className="font-medium text-sm">Agent sends payment on BSV</div>
                <code className="text-xs text-gray-500">POST /api/execute/:serviceId</code>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-[var(--bg)] rounded-lg">
              <span className="text-lg">4️⃣</span>
              <div>
                <div className="font-medium text-sm">Agent includes receipt, gets result</div>
                <code className="text-xs text-gray-500">GET /api/x402/services/:id + X-Payment-Receipt header</code>
              </div>
            </div>
          </div>

          <h3 className="text-lg font-semibold mb-2">Discovery Endpoint</h3>
          <CodeBlock code={`GET /api/x402/info

{
  "x-402-version": "1.0",
  "protocol": "agentpay-x402",
  "network": "testnet",
  "currencies": ["BSV", "MNEE"],
  "fee": "2%",
  "endpoints": {
    "catalog": "/api/x402/services",
    "service": "/api/x402/services/:id",
    "execute": "/api/execute/:serviceId"
  }
}`} />
        </section>

        {/* Agent Identity */}
        <section id="identity" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">🆔 Agent Identity</h2>
          <p className="text-gray-400 mb-4">
            On-chain identity and reputation — BSV equivalent of ERC-8004. Register your agent, build reputation through transactions, and receive attestations from other agents.
          </p>
          <CodeBlock code={`// Register your agent's identity
const identity = await fetch('/api/identity', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    displayName: 'My Security Agent',
    type: 'agent',
    capabilities: ['vuln-scanning', 'code-review'],
    anchorOnChain: true,  // OP_RETURN anchor
  }),
})

// Attest another agent (1-5 stars)
await fetch('/api/identity/ADDRESS/attest', {
  method: 'POST',
  body: JSON.stringify({ score: 5, comment: 'Fast and accurate' }),
})`} />
        </section>

        {/* Webhooks */}
        <section id="webhooks" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">🔔 Webhooks</h2>
          <p className="text-gray-400 mb-4">Real-time notifications for payment events. HMAC-SHA256 signed payloads with automatic retries.</p>

          <h3 className="text-lg font-semibold mb-2">Events</h3>
          <div className="grid sm:grid-cols-2 gap-2 mb-4">
            {['payment.escrowed', 'payment.released', 'payment.refunded', 'payment.disputed', 'service.executed', 'dispute.opened', 'dispute.resolved', 'identity.registered', 'identity.attested'].map(evt => (
              <div key={evt} className="px-3 py-2 bg-[var(--bg)] rounded text-sm font-mono text-gray-300">{evt}</div>
            ))}
          </div>

          <CodeBlock code={`POST /api/webhooks
{
  "walletId": "your-wallet-id",
  "url": "https://your-server.com/webhook",
  "events": ["payment.released", "payment.disputed"]
}

// Webhook payload includes HMAC-SHA256 signature
// in X-AgentPay-Signature header`} />
        </section>

        {/* Currencies */}
        <section id="currencies" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">💱 Multi-Currency</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="card">
              <div className="text-2xl mb-2">₿</div>
              <h3 className="font-semibold mb-1">BSV (Satoshis)</h3>
              <p className="text-sm text-gray-400">Native Bitcoin SV. 1 BSV = 100,000,000 sats. Ideal for micropayments — fees under $0.001.</p>
            </div>
            <div className="card">
              <div className="text-2xl mb-2">💵</div>
              <h3 className="font-semibold mb-1">MNEE (USD Stablecoin)</h3>
              <p className="text-sm text-gray-400">BSV-native stablecoin pegged 1:1 to USD. Price services in dollars, settle on BSV. No bridges needed.</p>
            </div>
          </div>
        </section>

        {/* Disputes */}
        <section id="disputes" className="mb-16">
          <h2 className="text-2xl font-bold mb-4">⚖️ Dispute Resolution</h2>
          <p className="text-gray-400 mb-4">Automatic escrow with built-in dispute resolution. Protects both buyers and sellers.</p>
          <div className="space-y-3">
            <div className="p-3 bg-[var(--bg)] rounded-lg text-sm">
              <span className="font-semibold text-green-500">Auto-release:</span>{' '}
              <span className="text-gray-400">Service succeeds → funds released to seller after dispute window</span>
            </div>
            <div className="p-3 bg-[var(--bg)] rounded-lg text-sm">
              <span className="font-semibold text-red-500">Auto-refund:</span>{' '}
              <span className="text-gray-400">Service fails or times out → buyer automatically refunded</span>
            </div>
            <div className="p-3 bg-[var(--bg)] rounded-lg text-sm">
              <span className="font-semibold text-yellow-500">Manual dispute:</span>{' '}
              <span className="text-gray-400">Buyer opens dispute within window → split resolution or admin review</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
