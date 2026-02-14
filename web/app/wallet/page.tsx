'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { CopyButton } from '@/components/CopyButton'
import { WalletBadge } from '@/components/WalletBadge'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { formatSats, formatDate, getExplorerUrl } from '@/lib/utils'
import type { Wallet, Transaction, UTXO } from '@/lib/types'

export default function WalletPage() {
  const [wallets, setWallets] = useState<string[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [utxos, setUtxos] = useState<UTXO[]>([])
  const [showPrivateKey, setShowPrivateKey] = useState(false)
  const [newWallet, setNewWallet] = useState<Wallet | null>(null)
  const [fundAmount, setFundAmount] = useState('10000')
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'transactions' | 'utxos'>('transactions')

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
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateWallet() {
    try {
      setLoading(true)
      const w = await api.createWallet()
      const updated = [...wallets, w.id]
      setWallets(updated)
      localStorage.setItem('agentpay_wallets', JSON.stringify(updated))
      setNewWallet(w)
      setSelectedWalletId(w.id)
      success('Wallet created successfully!')
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

  return (
    <main className="min-h-screen py-12 px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Wallet Management</h1>
          <p className="text-gray-400">Manage your BSV wallets for agent payments</p>
        </div>

        {/* Create Wallet */}
        <div className="card mb-6">
          <h2 className="text-xl font-semibold mb-4">Create New Wallet</h2>
          <button
            onClick={handleCreateWallet}
            disabled={loading}
            className="btn btn-primary"
          >
            {loading ? 'Creating...' : '+ Create Wallet'}
          </button>
        </div>

        {/* New Wallet Alert (one-time) */}
        {newWallet && (
          <div className="card mb-6 bg-yellow-500/5 border-yellow-500/20">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="font-semibold text-yellow-500 mb-1">Save Your Private Key!</h3>
                <p className="text-sm text-gray-400">
                  This is the ONLY time you'll see it. Store it securely — we don't save it.
                </p>
              </div>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-4 mb-3">
              <div className="text-xs text-gray-500 mb-1">Private Key</div>
              <div className="font-mono text-sm break-all">{newWallet.privateKey}</div>
            </div>
            <div className="flex gap-2">
              <CopyButton text={newWallet.privateKey} label="Copy Private Key" />
              <button
                onClick={() => setNewWallet(null)}
                className="btn btn-secondary text-sm"
              >
                I've saved it — Close
              </button>
            </div>
          </div>
        )}

        {/* Wallet Selector */}
        {wallets.length > 0 && (
          <div className="card mb-6">
            <label className="label">Select Wallet</label>
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
                <h2 className="text-2xl font-bold">Wallet Details</h2>
                <WalletBadge address={wallet.address} balance={wallet.balance} />
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

              {/* Fund Wallet (Demo Mode) */}
              <div className="border-t border-[var(--border)] pt-4">
                <label className="label">Fund Wallet (Demo Mode)</label>
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
                    className="btn btn-primary"
                  >
                    Fund
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Demo mode: adds balance via internal ledger (not real BSV)
                </p>
              </div>
            </div>

            {/* Tabs */}
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
                    <div className="text-center py-8 text-gray-400">
                      No transactions yet
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {transactions.map((tx, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-[var(--bg)] rounded-lg">
                          <div>
                            <a
                              href={getExplorerUrl(tx.txid)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-sm text-blue-500 hover:underline"
                            >
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
                    <div className="text-center py-8 text-gray-400">
                      No UTXOs available
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {utxos.map((utxo, i) => (
                        <div key={i} className="p-4 bg-[var(--bg)] rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <code className="text-sm text-gray-400">
                              {utxo.txid.slice(0, 12)}...:{utxo.vout}
                            </code>
                            <div className="font-semibold text-green-500">
                              {formatSats(utxo.value)} sats
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 font-mono break-all">
                            {utxo.scriptPubKey}
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
