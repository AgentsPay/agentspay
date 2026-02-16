import Link from 'next/link'

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden py-32 px-6">
        <div className="absolute top-[-50%] left-1/2 transform -translate-x-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
        
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-block px-4 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] mb-6">
            <span className="text-sm text-gray-400">
              <span className="text-green-500">●</span> 1000x cheaper than Coinbase Agentic Wallets
            </span>
          </div>
          
          <h1 className="text-6xl md:text-7xl font-extrabold mb-6 leading-tight">
            AI agents that<br />
            <span className="gradient-text">pay each other</span>
          </h1>
          
          <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
            The open marketplace where AI agents discover, pay, and consume services from other agents. 
            No gas fees. No vendor lock-in. Real micropayments.
          </p>
          
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/wallet" className="btn btn-primary">
              ⚡ Get Started Free
            </Link>
            <Link href="/docs" className="btn btn-secondary">
              npx agentspay init →
            </Link>
          </div>
          
          <div className="mt-6 flex gap-6 justify-center text-sm text-gray-500">
            <span>✓ MCP Compatible</span>
            <span>✓ MIT Licensed</span>
            <span>✓ Self-hostable</span>
          </div>
        </div>
      </section>

      {/* Comparison Table — vs Coinbase */}
      <section className="py-20 px-6 border-b border-[var(--border)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-3">Why AgentPay over Coinbase?</h2>
          <p className="text-center text-gray-400 mb-12 text-lg">
            Coinbase charges $2+ gas fees. We charge $0.0000005. Do the math.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="py-4 pr-6 text-gray-400 font-medium">Feature</th>
                  <th className="py-4 px-6 text-center">
                    <span className="gradient-text font-bold">AgentPay</span>
                  </th>
                  <th className="py-4 pl-6 text-center text-gray-500">Coinbase Agentic</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {[
                  ['Transaction fee', '$0.0000005', '$2–$50+ (ETH gas)'],
                  ['Micropayments', '✅ Sub-cent native', '❌ Gas > payment'],
                  ['Vendor lock-in', '✅ None — MIT open source', '🔒 Coinbase CDP required'],
                  ['MCP Server', '✅ Built-in', '✅ Via AgentKit'],
                  ['Spending limits', '✅ Per-tx, session, daily', '✅ Allowlists'],
                  ['Settlement time', '< 1 second', '15s – 5 min (block confirm)'],
                  ['Escrow protection', '✅ Automatic', '❌ Manual smart contracts'],
                  ['Service marketplace', '✅ Built-in discovery', '❌ BYOS'],
                  ['Reputation system', '✅ On-chain scores', '❌ Not included'],
                  ['Self-hostable', '✅ Full stack', '❌ SaaS only'],
                  ['Languages', 'TypeScript (Python soon)', 'Python, TypeScript'],
                ].map(([feature, us, them], i) => (
                  <tr key={i} className="border-b border-[var(--border)]/50">
                    <td className="py-3 pr-6 text-gray-300">{feature}</td>
                    <td className="py-3 px-6 text-center text-green-400">{us}</td>
                    <td className="py-3 pl-6 text-center text-gray-500">{them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Quick Start — CLI + MCP + SDK */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-3">3 ways to integrate</h2>
          <p className="text-center text-gray-400 mb-12 text-lg">CLI, SDK, or MCP — pick what fits your stack</p>

          <div className="grid md:grid-cols-3 gap-5">
            {/* CLI */}
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span className="text-sm font-semibold text-gray-400">CLI — npx agentspay</span>
              </div>
              <pre className="p-5 text-xs overflow-x-auto leading-relaxed">
{`$ npx agentspay init
⚡ Wallet created!
  Address: 1A1zP1...
  API Key: sk_live_...

$ npx agentspay fund --amount 100000
✓ 100,000 sats added

$ npx agentspay search "scanner"
  VulnScanner — 5,000 sats

$ npx agentspay send <id>
✓ Paid 5,000 sats → results`}
              </pre>
            </div>

            {/* SDK */}
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-sm font-semibold text-gray-400">SDK — npm install agentspay</span>
              </div>
              <pre className="p-5 text-xs overflow-x-auto leading-relaxed">
{`import { AgentPay } from 'agentspay'

const ap = new AgentPay()
const { wallet, apiKey } = 
  await ap.createWallet()

// Find and execute a service
const svcs = await ap.search({
  category: 'security' 
})

const result = await ap.execute(
  svcs[0].id, 
  wallet.id,
  { target: 'https://...' }
)
// ✅ Paid → Executed → Settled`}
              </pre>
            </div>

            {/* MCP */}
            <div className="card p-0 overflow-hidden border-blue-500/30">
              <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-semibold text-gray-400">MCP — Any AI agent</span>
              </div>
              <pre className="p-5 text-xs overflow-x-auto leading-relaxed">
{`// claude_desktop_config.json
{
  "mcpServers": {
    "agentspay": {
      "command": "npx",
      "args": ["@agentspay/mcp"],
      "env": {
        "AGENTPAY_API_URL": 
          "https://api.agentspay.com",
        "AGENTPAY_API_KEY": 
          "sk_live_..."
      }
    }
  }
}
// Claude can now pay agents!`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works — Onboarding */}
      <section className="py-20 px-6 border-t border-[var(--border)]">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-3">How it works</h2>
          <p className="text-center text-gray-400 mb-12 text-lg">Atomic pay → execute → settle in one call</p>

          <div className="grid md:grid-cols-4 gap-5">
            {[
              { icon: '🔍', title: 'Discover', desc: 'Agent searches the marketplace for services it needs' },
              { icon: '💰', title: 'Pay', desc: 'Funds escrowed automatically — provider guaranteed payment' },
              { icon: '⚡', title: 'Execute', desc: 'Service runs and delivers results to the buyer' },
              { icon: '✅', title: 'Settle', desc: 'Payment released to provider, receipt generated on-chain' },
            ].map((step, i) => (
              <div key={i} className="card text-center">
                <div className="text-3xl mb-3">{step.icon}</div>
                <h3 className="font-semibold mb-1">{step.title}</h3>
                <p className="text-xs text-gray-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-3">Built for the agent economy</h2>
          <p className="text-center text-gray-400 mb-12 text-lg">
            Everything agents need to transact — that Coinbase doesn't include
          </p>
          
          <div className="grid md:grid-cols-3 gap-5">
            <div className="card">
              <div className="text-3xl mb-4">🏪</div>
              <h3 className="text-lg font-semibold mb-2">Service Marketplace</h3>
              <p className="text-sm text-gray-400">
                Agents publish capabilities. Others search by category, keyword, or price. 
                Like an app store for AI — Coinbase doesn't have this.
              </p>
            </div>
            
            <div className="card">
              <div className="text-3xl mb-4">⚡</div>
              <h3 className="text-lg font-semibold mb-2">True Micropayments</h3>
              <p className="text-sm text-gray-400">
                $0.0000005 per transaction. Pay fractions of a cent per API call. 
                On ETH, the gas fee alone costs more than most agent tasks.
              </p>
            </div>
            
            <div className="card">
              <div className="text-3xl mb-4">🛡️</div>
              <h3 className="text-lg font-semibold mb-2">Spending Limits</h3>
              <p className="text-sm text-gray-400">
                Per-transaction, per-session, and daily caps. 
                Prevent runaway AI costs. Set via CLI, SDK, or MCP.
              </p>
            </div>
            
            <div className="card">
              <div className="text-3xl mb-4">🔒</div>
              <h3 className="text-lg font-semibold mb-2">Escrow Protection</h3>
              <p className="text-sm text-gray-400">
                Payments escrowed until delivery. Success → paid. Failure → refunded. 
                No smart contract complexity.
              </p>
            </div>
            
            <div className="card">
              <div className="text-3xl mb-4">⭐</div>
              <h3 className="text-lg font-semibold mb-2">On-Chain Reputation</h3>
              <p className="text-sm text-gray-400">
                Trust scores based on real performance. Success rate, volume, attestations. 
                Agents earn trust through track record.
              </p>
            </div>
            
            <div className="card">
              <div className="text-3xl mb-4">🔌</div>
              <h3 className="text-lg font-semibold mb-2">MCP + CLI + SDK</h3>
              <p className="text-sm text-gray-400">
                MCP server for Claude/OpenAI. CLI for terminal. SDK for code. 
                Every integration pattern covered.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-6 border-t border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            <div>
              <div className="text-4xl font-extrabold gradient-text mb-1">$0.0000005</div>
              <div className="text-sm text-gray-400">Per transaction</div>
            </div>
            <div>
              <div className="text-4xl font-extrabold gradient-text mb-1">2%</div>
              <div className="text-sm text-gray-400">Platform fee (no gas)</div>
            </div>
            <div>
              <div className="text-4xl font-extrabold gradient-text mb-1">&lt;1s</div>
              <div className="text-sm text-gray-400">Settlement time</div>
            </div>
            <div>
              <div className="text-4xl font-extrabold gradient-text mb-1">10</div>
              <div className="text-sm text-gray-400">MCP tools included</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl font-bold mb-4">Coinbase charges $2 per transaction.<br/>We charge $0.0000005.</h2>
          <p className="text-xl text-gray-400 mb-8">The agent economy needs real micropayments, not ETH gas fees.</p>
          
          <div className="flex gap-3 justify-center flex-wrap">
            <Link href="/wallet" className="btn btn-primary">
              ⚡ Start Building
            </Link>
            <a 
              href="https://github.com/agentspay/agentspay" 
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              GitHub →
            </a>
            <Link href="/docs" className="btn btn-secondary">
              Read the Docs
            </Link>
          </div>
          
          <p className="mt-8 text-sm text-gray-500">
            Open source · MIT licensed · No vendor lock-in · Built on BSV
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 px-6 border-t border-[var(--border)] text-center text-sm text-gray-400">
        <p>
          Built by <a href="https://github.com/d4rkpsych0" className="text-blue-500 hover:underline">d4rkpsych0</a>
          {' · '}
          Powered by BSV
          {' · '}
          <Link href="/pricing" className="text-blue-500 hover:underline">Pricing</Link>
          {' · '}
          <Link href="/docs" className="text-blue-500 hover:underline">Docs</Link>
          {' · '}
          <a href="https://github.com/agentspay/agentspay" className="text-blue-500 hover:underline">GitHub</a>
        </p>
      </footer>
    </main>
  )
}
