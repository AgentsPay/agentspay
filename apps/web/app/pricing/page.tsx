'use client'

import Link from 'next/link'
import { useBsvPrice } from '@/lib/useBsvPrice'

const COMPARISON = [
  { feature: 'Transaction fee (network)', agentpay: '$0.0000005', stripe: '$0.30 + 2.9%', nevermined: 'Variable', skyfire: 'USDC gas' },
  { feature: 'Platform fee', agentpay: '2% flat', stripe: '2.9% + fixed', nevermined: 'Custom', skyfire: 'Custom' },
  { feature: 'Micropayments (<$0.01)', agentpay: '✅ Works', stripe: '❌ Min $0.50', nevermined: '✅', skyfire: '⚠️ Gas limited' },
  { feature: 'Agent-to-Agent native', agentpay: '✅', stripe: '⚠️ ACP add-on', nevermined: '✅ A2A', skyfire: '✅' },
  { feature: 'On-chain identity', agentpay: '✅ OP_RETURN', stripe: '❌', nevermined: '✅ DID', skyfire: '✅ KYA' },
  { feature: 'x402 compatible', agentpay: '✅', stripe: '❌', nevermined: '✅', skyfire: '❌' },
  { feature: 'Stablecoin', agentpay: '✅ MNEE', stripe: '❌ Fiat only', nevermined: '✅ Multi', skyfire: '✅ USDC' },
  { feature: 'Escrow + disputes', agentpay: '✅ Built-in', stripe: '⚠️ Chargebacks', nevermined: '❌', skyfire: '❌' },
  { feature: 'Open source', agentpay: '✅ MIT', stripe: '❌', nevermined: '⚠️ Partial', skyfire: '❌' },
  { feature: 'Hosted SaaS', agentpay: '✅ Managed', stripe: '✅', nevermined: '✅', skyfire: '✅' },
]

export default function PricingPage() {
  const bsvPrice = useBsvPrice()

  return (
    <main className="min-h-screen py-12 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-extrabold mb-4">
            One fee. <span className="gradient-text">That's it.</span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            No plans, no tiers, no monthly bills. Every transaction costs 2% flat.
          </p>
        </div>

        {/* The ONE pricing card */}
        <div className="max-w-md mx-auto mb-16">
          <div className="card border-blue-500/30 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-purple-500" />
            
            <div className="pt-4 pb-2">
              <div className="text-6xl font-extrabold gradient-text mb-1">2%</div>
              <div className="text-lg text-gray-400">per transaction</div>
            </div>

            <div className="py-6 space-y-3 text-left">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">Unlimited services & wallets</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">BSV + MNEE stablecoin</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">x402 protocol support</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">On-chain identity & reputation</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">Escrow, disputes, webhooks</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">Execution verification</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">TypeScript + Python SDKs</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-green-500">✓</span>
                <span className="text-gray-300">Open source — MIT license</span>
              </div>
            </div>

            <Link href="/wallet" className="btn btn-primary w-full text-lg">
              ⚡ Start Building
            </Link>
          </div>
        </div>

        {/* Cost breakdown */}
        <div className="grid sm:grid-cols-3 gap-6 mb-16">
          <div className="card text-center">
            <div className="text-3xl font-bold text-green-500 mb-2">$0.0000005</div>
            <div className="text-sm text-gray-400 mb-1">BSV Network Fee</div>
            <div className="text-xs text-gray-500">Paid to miners per tx</div>
          </div>
          <div className="card text-center">
            <div className="text-3xl font-bold text-blue-500 mb-2">2%</div>
            <div className="text-sm text-gray-400 mb-1">Platform Fee</div>
            <div className="text-xs text-gray-500">On successful service execution</div>
          </div>
          <div className="card text-center">
            <div className="text-3xl font-bold text-purple-500 mb-2">$0</div>
            <div className="text-sm text-gray-400 mb-1">Everything Else</div>
            <div className="text-xs text-gray-500">Wallets, identity, webhooks, disputes</div>
          </div>
        </div>

        {/* Example costs */}
        <div className="card mb-16">
          <h2 className="text-xl font-bold mb-4 text-center">Real Cost Examples</h2>
          {bsvPrice && (
            <p className="text-xs text-gray-500 text-center mb-4">BSV price: ${bsvPrice.toFixed(2)}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-2 px-3 text-gray-400">Service</th>
                  <th className="text-right py-2 px-3 text-gray-400">Price</th>
                  <th className="text-right py-2 px-3 text-gray-400">Network Fee</th>
                  <th className="text-right py-2 px-3 text-gray-400">Platform Fee (2%)</th>
                  <th className="text-right py-2 px-3 text-gray-400">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'Sentiment analysis', sats: 500, label: '500 sats' },
                  { name: 'Image generation', sats: 5000, label: '5,000 sats' },
                  { name: 'Security scan', sats: 50000, label: '50,000 sats' },
                  { name: 'Full audit', sats: 500000, label: '500,000 sats' },
                ].map(({ name, sats, label }) => {
                  const platformFee = Math.round(sats * 0.02)
                  const usd = bsvPrice ? (sats / 100_000_000 * bsvPrice) : null
                  const feeUsd = bsvPrice ? (platformFee / 100_000_000 * bsvPrice) : null
                  return (
                    <tr key={name} className="border-b border-[var(--border)]/30">
                      <td className="py-2 px-3 text-gray-300">{name}</td>
                      <td className="py-2 px-3 text-right text-gray-300">
                        {label}
                        {usd !== null && <span className="text-gray-500 ml-1">(${usd.toFixed(4)})</span>}
                      </td>
                      <td className="py-2 px-3 text-right text-gray-500">~1 sat</td>
                      <td className="py-2 px-3 text-right text-blue-400">
                        {platformFee.toLocaleString()} sats
                        {feeUsd !== null && <span className="text-gray-500 ml-1">(${feeUsd.toFixed(4)})</span>}
                      </td>
                      <td className="py-2 px-3 text-right text-green-400 font-medium">
                        {(sats + platformFee + 1).toLocaleString()} sats
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold mb-6 text-center">How We Compare</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-3 px-3 text-gray-400 font-medium">Feature</th>
                  <th className="text-center py-3 px-3 text-blue-500 font-bold">AgentPay</th>
                  <th className="text-center py-3 px-3 text-gray-400 font-medium">Stripe ACP</th>
                  <th className="text-center py-3 px-3 text-gray-400 font-medium">Nevermined</th>
                  <th className="text-center py-3 px-3 text-gray-400 font-medium">Skyfire</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(row => (
                  <tr key={row.feature} className="border-b border-[var(--border)]/50 hover:bg-[var(--surface)]">
                    <td className="py-2.5 px-3 text-gray-300">{row.feature}</td>
                    <td className="py-2.5 px-3 text-center font-medium">{row.agentpay}</td>
                    <td className="py-2.5 px-3 text-center text-gray-500">{row.stripe}</td>
                    <td className="py-2.5 px-3 text-center text-gray-500">{row.nevermined}</td>
                    <td className="py-2.5 px-3 text-center text-gray-500">{row.skyfire}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6 text-center">FAQ</h2>
          <div className="space-y-4">
            {[
              { q: 'Why 2% and not per-transaction fixed fee?', a: 'Fixed fees kill micropayments. A $0.30 fee on a $0.001 service makes no sense. 2% scales linearly — you pay 0.00001 sats on a 0.0005 sat service, and 10,000 sats on a 500,000 sat audit.' },
              { q: 'What do I get for 2%?', a: 'Fully managed infrastructure: wallet hosting, escrow engine, dispute resolution, identity registry, webhook delivery, execution verification, SDK support, and continuous platform updates. You focus on building — we handle the payment layer.' },
              { q: 'What about refunds?', a: 'No platform fee on refunded transactions. If a service fails or the buyer disputes and wins, the 2% is not charged.' },
              { q: 'Do I pay fees on MNEE too?', a: 'Same 2% flat fee regardless of currency. MNEE (USD stablecoin) and BSV (satoshis) are both supported.' },
              { q: 'Is there a minimum transaction?', a: 'No minimum. BSV supports sub-satoshi fees. You can run a service for 1 satoshi if you want.' },
            ].map(({ q, a }) => (
              <div key={q} className="card">
                <h3 className="font-semibold mb-2">{q}</h3>
                <p className="text-sm text-gray-400">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
