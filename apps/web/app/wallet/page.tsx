'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { CopyButton } from '@/components/CopyButton'
import { OnboardingWizard } from '@/components/OnboardingWizard'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { formatSats, formatDate, getExplorerUrl, formatCurrency, satsToUsd, formatMneeWithBsv } from '@/lib/utils'
import { useBsvPrice } from '@/lib/useBsvPrice'
import type { Wallet, Transaction, UTXO } from '@/lib/types'

export default function WalletPage() {
  const [wallets, setWallets] = useState<string[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [newWallet, setNewWallet] = useState<Wallet | null>(null)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [newPrivateKey, setNewPrivateKey] = useState<string | null>(null)
  const [fundAmount, setFundAmount] = useState('10000')
  const [wizardCreds, setWizardCreds] = useState<{ apiKey?: string; privateKey?: string; walletId?: string; address?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'transactions' | 'utxos'>('transactions')
  const [showOnboarding, setShowOnboarding] = useState(false)

  const bsvPrice = useBsvPrice()
  const { toasts, success, error: showError, dismiss } = useToast()

  useEffect(() => {
    const stored = localStorage.getItem('agentpay_wallets')
    if (stored) {
      const ids = JSON.parse(stored)
      setWallets(ids)
      if (ids.length > 0 && !selectedWalletId) {
        setSelectedWalletId(ids[0])
      }
    }
  }, [selectedWalletId])

  useEffect(() => {
    if (selectedWalletId) {
      loadWallet(selectedWalletId)
    }
  }, [selectedWalletId])

  async function loadWallet(id: string) {
    try {
      setLoading(true)
      const [w, txs, utxoList] = await Promise.all([
        api.getWallet(id),
        api.getTransactions(id).catch(() => []),
        api.getUtxos(id).catch(() => []),
      ])
      setWallet(w)
      setTransactions(txs)
      setUtxos(utxoList)
    } catch (err: any) {
      if (err.message?.includes('401') || err.message?.includes('Invalid API key')) {
        showError('Session expired. Removing stale wallet.')
        const updated = wallets.filter(w => w !== id)
        setWallets(updated)
        localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
        setSelectedWalletId(updated.length > 0 ? updated[0] : null)
        setWallet(null)
      } else {
        showError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleConnect(provider: string, data?: { privateKey?: string; agentName?: string; capabilities?: string[] }) {
    try {
      setLoading(true)

      if (provider === 'provision') {
        // Agent provision: creates wallet + identity in one call
        const agentName = data?.agentName || 'My Agent'
        const result = await api.provisionAgent(agentName, {
          type: 'agent',
          capabilities: data?.capabilities || [],
        })
        const updated = [...wallets, result.agent.walletId]
        setWallets(updated)
        localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
        setNewWallet({ id: result.agent.walletId, address: result.agent.address } as any)
        setNewApiKey(result.agent.apiKey)
        setNewPrivateKey(result.agent.privateKey)
        setSelectedWalletId(result.agent.walletId)
        setShowOnboarding(false)
        setWizardCreds({
          apiKey: result.agent.apiKey,
          privateKey: result.agent.privateKey,
          walletId: result.agent.walletId,
          address: result.agent.address,
          envConfig: result.envConfig,
          quickStart: result.quickStart,
        } as any)
        success('Agent provisioned! Save your credentials.')
      } else if (provider === 'internal') {
        const { wallet: w, apiKey, privateKey } = await api.connectInternal()
        const updated = [...wallets, w.id]
        setWallets(updated)
        localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
        setNewWallet(w)
        setNewApiKey(apiKey)
        setNewPrivateKey(privateKey)
        setSelectedWalletId(w.id)
        setShowOnboarding(false)
        setWizardCreds({ apiKey, privateKey, walletId: w.id, address: w.address })
        success('Wallet created! Save your credentials below.')
      } else if (provider === 'handcash') {
        const { authUrl } = await api.connectHandCash()
        if (authUrl) {
          window.location.href = authUrl
        } else {
          showError('HandCash not configured on server.')
        }
      } else if (provider === 'yours') {
        // @ts-ignore
        const yoursWallet = typeof window !== 'undefined' && ((window as any).yours || (window as any).panda)
        if (!yoursWallet) {
          showError('Yours Wallet extension not detected. Install from yours.org')
          return
        }
        const pubKey = await yoursWallet.getPublicKey()
        const w = await api.connectYours(pubKey)
        const updated = [...wallets, w.id]
        setWallets(updated)
        localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
        setSelectedWalletId(w.id)
        setShowOnboarding(false)
        success('Yours Wallet connected!')
      } else if (provider === 'import') {
        if (!data?.privateKey) return
        const w = await api.importWallet(data.privateKey)
        const updated = [...wallets, w.id]
        setWallets(updated)
        localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
        setSelectedWalletId(w.id)
        setShowOnboarding(false)
        success('Wallet imported successfully!')
      }
    } catch (err: any) {
      showError(err.message || `Failed to connect via ${provider}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!selectedWalletId || !wallet) return
    if (!confirm(`Disconnect wallet ${wallet.provider}? This cannot be undone.`)) return

    try {
      setLoading(true)
      await api.disconnectWallet(selectedWalletId)
      const updated = wallets.filter(id => id !== selectedWalletId)
      setWallets(updated)
      localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
      setSelectedWalletId(updated.length > 0 ? updated[0] : null)
      setWallet(null)
      success('Wallet disconnected')
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFund() {
    if (!selectedWalletId) return
    try {
      setLoading(true)
      const result = await api.fundWallet(selectedWalletId, Number(fundAmount))
      success(`Funded ${formatSats(result.funded)} sats!`)
      await loadWallet(selectedWalletId)
      setFundAmount('10000')
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const getProviderBadge = (provider: string) => {
    const colors: Record<string, string> = {
      handcash: 'bg-green-500/10 text-green-500 border-green-500/20',
      yours: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
      internal: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
      import: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    }
    const labels: Record<string, string> = {
      handcash: '🤝 HandCash',
      yours: '👛 Yours',
      internal: '⚡ Internal',
      import: '🔑 Imported',
    }
    return (
      <span className={`inline-block px-3 py-1 text-xs font-medium border rounded ${colors[provider] || colors.internal}`}>
        {labels[provider] || provider}
      </span>
    )
  }

  const hasWallet = wallets.length > 0 && wallet

  return (
    <main className="min-h-screen py-12 px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      <OnboardingWizard
        open={showOnboarding}
        onClose={() => { setShowOnboarding(false); setWizardCreds(null) }}
        onConnect={handleConnect}
        loading={loading}
        credentials={wizardCreds}
      />

      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">Wallet</h1>
            <p className="text-gray-400">
              {hasWallet ? 'Manage your BSV wallet' : 'Connect a wallet to get started'}
            </p>
          </div>
          <button
            onClick={() => setShowOnboarding(true)}
            className="btn btn-primary text-sm flex items-center gap-2"
          >
            <span>{hasWallet ? '+ Add Wallet' : '⚡ Connect Wallet'}</span>
          </button>
        </div>

        {/* Empty State — no wallet connected */}
        {!hasWallet && !newWallet && (
          <div className="card flex flex-col items-center justify-center py-16 sm:py-20 text-center">
            <div className="text-6xl mb-6">👛</div>
            <h2 className="text-2xl font-bold mb-2">Welcome to AgentPay</h2>
            <p className="text-gray-400 mb-8 max-w-md">
              Connect your wallet or set up your AI agent to start using the marketplace.
            </p>
            <button
              onClick={() => setShowOnboarding(true)}
              className="btn btn-primary text-lg px-8 py-3"
            >
              🚀 Get Started
            </button>
            <p className="text-xs text-gray-500 mt-4">
              🔒 Your private key is shown once on creation — save it securely
            </p>
          </div>
        )}

        {/* New Wallet Credentials (one-time) */}
        {newWallet && (newPrivateKey || newApiKey) && (
          <div className="card mb-6 bg-yellow-500/5 border-yellow-500/20">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-yellow-500 mb-1">Save Your Credentials!</h3>
                <p className="text-sm text-gray-400">
                  This is the ONLY time you'll see them. Store them securely.
                </p>
              </div>
            </div>
            {newApiKey && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 mb-3">
                <div className="text-xs text-gray-500 mb-1">API Key</div>
                <div className="font-mono text-sm break-all">{newApiKey}</div>
                <CopyButton text={newApiKey} label="Copy API Key" />
              </div>
            )}
            {newPrivateKey && (
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 mb-3">
                <div className="text-xs text-gray-500 mb-1">Private Key (WIF)</div>
                <div className="font-mono text-sm break-all">{newPrivateKey}</div>
                <CopyButton text={newPrivateKey} label="Copy Private Key" />
              </div>
            )}
            <button
              onClick={() => { setNewWallet(null); setNewApiKey(null); setNewPrivateKey(null) }}
              className="btn btn-secondary text-sm mt-2"
            >
              ✓ I've saved them — Close
            </button>
          </div>
        )}

        {/* Wallet Selector (multiple wallets) */}
        {wallets.length > 1 && (
          <div className="card mb-6">
            <label className="label">Active Wallet</label>
            <select
              value={selectedWalletId || ''}
              onChange={(e) => setSelectedWalletId(e.target.value)}
              className="input"
            >
              {wallets.map(id => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </div>
        )}

        {/* Wallet Details */}
        {wallet && (
          <>
            <div className="card mb-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold mb-2">Wallet Details</h2>
                  {getProviderBadge(wallet.provider)}
                </div>
                <button onClick={handleDisconnect} className="btn btn-secondary text-sm">
                  Disconnect
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <div>
                  <div className="text-sm text-gray-400 mb-1">Address</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm flex-1 truncate">{wallet.address}</code>
                    <CopyButton text={wallet.address} />
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-400 mb-1">Wallet ID</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm flex-1 truncate">{wallet.id}</code>
                    <CopyButton text={wallet.id} />
                  </div>
                </div>
              </div>

              {/* Multi-Currency Balances */}
              {wallet.balances && (
                <div className="border-t border-[var(--border)] pt-4 mb-4">
                  <div className="text-sm text-gray-400 mb-2">Balances</div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-[var(--bg)] rounded-lg p-4">
                      <div className="text-xs text-gray-500 mb-1">BSV</div>
                      <div className="text-2xl font-bold text-green-500">
                        {formatSats(wallet.balances.BSV.amount)} <span className="text-sm text-gray-500">sats</span>
                      </div>
                      {bsvPrice && (
                        <div className="text-sm text-gray-400 mt-1">
                          ≈ {satsToUsd(wallet.balances.BSV.amount, bsvPrice)} USD
                        </div>
                      )}
                    </div>
                    <div className="bg-[var(--bg)] rounded-lg p-4">
                      <div className="text-xs text-gray-500 mb-1">MNEE</div>
                      <div className="text-2xl font-bold text-blue-500">
                        {formatCurrency(wallet.balances.MNEE.amount, 'MNEE')}
                      </div>
                      {bsvPrice && (
                        <div className="text-sm text-gray-400 mt-1">
                          {formatMneeWithBsv(wallet.balances.MNEE.amount, bsvPrice)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Fund Wallet */}
              {wallet.provider === 'internal' && (
                <div className="border-t border-[var(--border)] pt-4">
                  <label className="label">Fund Wallet</label>
                  
                  {/* Real mode: show address to send BSV */}
                  <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 mb-3">
                    <p className="text-sm text-gray-400 mb-2">Send BSV to this address to fund your wallet:</p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm text-green-500 font-mono break-all flex-1">{wallet.address}</code>
                      <CopyButton text={wallet.address} label="Copy" />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      💡 Start small — even $10 in BSV is enough for hundreds of transactions
                    </p>
                  </div>

                  {/* Demo fund — prominent card */}
                  <div className="mt-4 bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">🧪</span>
                      <h4 className="font-semibold text-purple-400">Test Mode: Fund Wallet</h4>
                    </div>
                    <p className="text-xs text-gray-400 mb-3">
                      Add test balance to try out the platform. Only works when demo mode is enabled on the server.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={fundAmount}
                        onChange={(e) => setFundAmount(e.target.value)}
                        placeholder="Amount in satoshis"
                        className="input flex-1"
                        min="0"
                      />
                      <button
                        onClick={handleFund}
                        disabled={loading || !fundAmount}
                        className="btn btn-primary text-sm bg-purple-600 hover:bg-purple-700"
                      >
                        Fund (Demo)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Transactions / UTXOs Tabs */}
            <div className="card">
              <div className="flex gap-4 mb-6 border-b border-[var(--border)] pb-3">
                <button
                  onClick={() => setView('transactions')}
                  className={`font-semibold ${view === 'transactions' ? 'text-blue-500' : 'text-gray-400'}`}
                >
                  Transactions
                </button>
                <button
                  onClick={() => setView('utxos')}
                  className={`font-semibold ${view === 'utxos' ? 'text-blue-500' : 'text-gray-400'}`}
                >
                  UTXOs
                </button>
              </div>

              {view === 'transactions' && (
                <div>
                  {transactions.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">No transactions yet</div>
                  ) : (
                    <div className="space-y-3">
                      {transactions.map((tx, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-[var(--bg)] rounded-lg">
                          <div>
                            <a href={getExplorerUrl(tx.txid)} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-sm text-blue-500 hover:underline">
                              {tx.txid.slice(0, 12)}...{tx.txid.slice(-12)}
                            </a>
                            <div className="text-xs text-gray-500 mt-1">
                              {formatDate(new Date(tx.time * 1000))} • {tx.confirmations} confirmations
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`font-semibold ${tx.value > 0 ? 'text-green-500' : 'text-gray-400'}`}>
                              {tx.value > 0 ? '+' : ''}{formatSats(tx.value)} sats
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {view === 'utxos' && (
                <div>
                  {utxos.length === 0 ? (
                    <div className="text-center py-8 text-gray-400">No UTXOs available</div>
                  ) : (
                    <div className="space-y-3">
                      {utxos.map((utxo, i) => (
                        <div key={i} className="p-4 bg-[var(--bg)] rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <code className="text-sm text-gray-400">
                              {utxo.txid.slice(0, 12)}...:{utxo.vout}
                            </code>
                            <div className="font-semibold text-green-500">
                              {formatSats(utxo.amount)} sats
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 font-mono break-all">
                            {utxo.script}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
