'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { JsonInput } from '@/components/JsonInput'
import { CopyButton } from '@/components/CopyButton'
import { WalletBadge } from '@/components/WalletBadge'
import { ReputationStars } from '@/components/ReputationStars'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { formatSats, formatDate, getExplorerUrl, formatPrice } from '@/lib/utils'
import type { Service, Wallet, ExecuteResult, Reputation, Receipt } from '@/lib/types'

export default function ExecuteServicePage() {
  const params = useParams()
  const serviceId = params.serviceId as string

  const [service, setService] = useState<Service | null>(null)
  const [reputation, setReputation] = useState<Reputation | null>(null)
  const [wallets, setWallets] = useState<string[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState('')
  const [selectedWallet, setSelectedWallet] = useState<Wallet | null>(null)
  const [input, setInput] = useState('{}')
  const [inputValid, setInputValid] = useState(false)
  const [parsedInput, setParsedInput] = useState<any>(null)
  const [result, setResult] = useState<ExecuteResult | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [executing, setExecuting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeEvidence, setDisputeEvidence] = useState('')
  const [openingDispute, setOpeningDispute] = useState(false)
  const [disputeWindowEnds, setDisputeWindowEnds] = useState<Date | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<string>('')

  const { toasts, success: showSuccess, error: showError, dismiss } = useToast()

  useEffect(() => {
    loadService()
    const stored = localStorage.getItem('agentpay_wallets')
    if (stored) {
      const ids = JSON.parse(stored)
      setWallets(ids)
      if (ids.length > 0) {
        setSelectedWalletId(ids[0])
      }
    }
  }, [serviceId])

  useEffect(() => {
    if (selectedWalletId) {
      loadWallet()
    }
  }, [selectedWalletId])

  // Countdown timer for dispute window
  useEffect(() => {
    if (!disputeWindowEnds) return
    
    const interval = setInterval(() => {
      const now = new Date()
      const diff = disputeWindowEnds.getTime() - now.getTime()
      
      if (diff <= 0) {
        setTimeRemaining('Expired')
        clearInterval(interval)
        return
      }
      
      const minutes = Math.floor(diff / 1000 / 60)
      const seconds = Math.floor((diff / 1000) % 60)
      setTimeRemaining(`${minutes}m ${seconds}s`)
    }, 1000)
    
    return () => clearInterval(interval)
  }, [disputeWindowEnds])

  async function loadService() {
    try {
      setLoading(true)
      const s = await api.getService(serviceId)
      setService(s)
      
      const rep = await api.getReputation(s.agentId)
      setReputation(rep)
      
      setError(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadWallet() {
    try {
      const w = await api.getWallet(selectedWalletId)
      setSelectedWallet(w)
    } catch (err: any) {
      showError(err.message)
    }
  }

  async function handleExecute() {
    if (!service || !selectedWalletId || !inputValid) return

    try {
      setExecuting(true)
      setError(null)
      setResult(null)
      setReceipt(null)

      const res = await api.executeService(serviceId, selectedWalletId, parsedInput)
      setResult(res)
      showSuccess('Service executed successfully!')
      
      // Load receipt if available
      if (res.paymentId) {
        try {
          const rcpt = await api.getReceipt(res.paymentId)
          setReceipt(rcpt)
          
          // Set dispute window countdown
          if (service.disputeWindowMs) {
            const endsAt = new Date(Date.now() + service.disputeWindowMs)
            setDisputeWindowEnds(endsAt)
          }
        } catch (err) {
          // Receipt might not be available yet
          console.error('Failed to load receipt:', err)
        }
      }
      
      await loadWallet() // Refresh balance
    } catch (err: any) {
      setError(err.message)
      showError(err.message)
    } finally {
      setExecuting(false)
    }
  }

  async function handleOpenDispute() {
    if (!result || !disputeReason.trim()) return
    
    try {
      setOpeningDispute(true)
      await api.disputePayment(result.paymentId, disputeReason, disputeEvidence || undefined)
      showSuccess('Dispute opened successfully')
      setDisputeReason('')
      setDisputeEvidence('')
      setDisputeWindowEnds(null)
    } catch (err: any) {
      showError(err.message)
    } finally {
      setOpeningDispute(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen py-12 px-6">
        <div className="max-w-4xl mx-auto text-center py-12 text-gray-400">
          Loading service...
        </div>
      </main>
    )
  }

  if (error && !service) {
    return (
      <main className="min-h-screen py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="card text-center py-12">
            <div className="text-red-500 text-xl mb-2">Service Not Found</div>
            <div className="text-gray-400 mb-6">{error}</div>
            <a href="/marketplace" className="btn btn-primary inline-flex">
              Back to Marketplace
            </a>
          </div>
        </div>
      </main>
    )
  }

  if (!service) return null

  const canExecute = selectedWallet && inputValid && (
    (service.currency === 'BSV' && selectedWallet.balances?.BSV! >= service.price) ||
    (service.currency === 'MNEE' && selectedWallet.balances?.MNEE! >= service.price)
  )

  return (
    <main className="min-h-screen py-12 px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <a href="/marketplace" className="text-sm text-gray-400 hover:text-white mb-4 inline-block">
            ← Back to Marketplace
          </a>
          <h1 className="text-4xl font-bold mb-2">{service.name}</h1>
          <p className="text-gray-400">{service.description}</p>
        </div>

        {/* Service Info */}
        <div className="card mb-6">
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            <div>
              <div className="text-sm text-gray-400 mb-1">Category</div>
              <span className="inline-block px-3 py-1 text-sm font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded">
                {service.category}
              </span>
            </div>
            
            <div>
              <div className="text-sm text-gray-400 mb-1">Price ({service.currency})</div>
              <div className="text-2xl font-bold text-green-500">
                {service.currency === 'BSV' ? (
                  <>{formatSats(service.price)} <span className="text-sm text-gray-500">sats</span></>
                ) : (
                  formatPrice(service.price, service.currency)
                )}
              </div>
            </div>
          </div>

          {(service.timeoutMs || service.disputeWindowMs) && (
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              {service.timeoutMs && (
                <div>
                  <div className="text-sm text-gray-400 mb-1">Timeout</div>
                  <div className="text-lg">{Math.round(service.timeoutMs / 1000)}s</div>
                </div>
              )}
              {service.disputeWindowMs && (
                <div>
                  <div className="text-sm text-gray-400 mb-1">Dispute Window</div>
                  <div className="text-lg">{Math.round(service.disputeWindowMs / 1000 / 60)} minutes</div>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-[var(--border)] pt-4">
            <div className="text-sm text-gray-400 mb-1">Provider</div>
            <div className="flex items-center gap-3">
              <code className="text-sm">{service.agentId}</code>
              {reputation && <ReputationStars successRate={reputation.successRate} size="sm" />}
            </div>
          </div>
        </div>

        {/* Wallet Selection */}
        <div className="card mb-6">
          <h2 className="text-xl font-semibold mb-4">Select Payment Wallet</h2>
          
          {wallets.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-400 mb-4">You need a wallet to execute services</p>
              <a href="/wallet" className="btn btn-primary inline-flex">
                Create Wallet
              </a>
            </div>
          ) : (
            <>
              <select
                value={selectedWalletId}
                onChange={(e) => setSelectedWalletId(e.target.value)}
                className="input mb-3"
              >
                {wallets.map(id => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
              
              {selectedWallet && selectedWallet.balances && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <WalletBadge address={selectedWallet.address} balance={selectedWallet.balance} />
                  </div>
                  
                  {service.currency === 'BSV' && selectedWallet.balances.BSV < service.price && (
                    <div className="text-sm text-red-500">
                      Insufficient BSV (need {formatSats(service.price - selectedWallet.balances.BSV)} more sats)
                    </div>
                  )}
                  
                  {service.currency === 'MNEE' && selectedWallet.balances.MNEE < service.price && (
                    <div className="text-sm text-red-500">
                      Insufficient MNEE (need {formatPrice(service.price - selectedWallet.balances.MNEE, 'MNEE')} more)
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Input */}
        <div className="card mb-6">
          <h2 className="text-xl font-semibold mb-4">Service Input</h2>
          <JsonInput
            value={input}
            onChange={(val, valid, parsed) => {
              setInput(val)
              setInputValid(valid)
              setParsedInput(parsed)
            }}
          />
          <p className="text-xs text-gray-500 mt-2">
            Provide input as JSON. The service will receive this data.
          </p>
        </div>

        {/* Execute Button */}
        <div className="card mb-6">
          <button
            onClick={handleExecute}
            disabled={!canExecute || executing}
            className="btn btn-primary w-full text-lg"
          >
            {executing ? 'Executing...' : `Execute Service (${service.currency === 'BSV' ? formatSats(service.price) + ' sats' : formatPrice(service.price, service.currency)})`}
          </button>
          
          {!selectedWallet && (
            <p className="text-sm text-gray-400 mt-3 text-center">
              Please select a wallet
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="card bg-red-500/5 border-red-500/20 mb-6">
            <div className="flex items-start gap-3">
              <span className="text-red-500 text-xl">✕</span>
              <div>
                <div className="font-semibold text-red-500 mb-1">Execution Failed</div>
                <div className="text-sm text-gray-400">{error}</div>
              </div>
            </div>
          </div>
        )}

        {/* Result with Receipt */}
        {result && (
          <div className="space-y-6">
            <div className="card bg-green-500/5 border-green-500/20">
              <div className="flex items-start gap-3 mb-4">
                <span className="text-green-500 text-2xl">✓</span>
                <div>
                  <h3 className="text-xl font-semibold text-green-500 mb-1">Success!</h3>
                  <div className="text-sm text-gray-400">
                    Executed in {result.executionTimeMs}ms
                  </div>
                </div>
                {result.verified !== undefined && (
                  <div className={`ml-auto px-3 py-1 text-sm rounded ${result.verified ? 'bg-green-500/10 text-green-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                    {result.verified ? '✓ Verified' : '⚠ Unverified'}
                  </div>
                )}
              </div>

              <div className="grid md:grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-400 mb-1">Payment ID</div>
                  <div className="flex items-center gap-2">
                    <code className="text-sm flex-1 truncate">{result.paymentId}</code>
                    <CopyButton text={result.paymentId} />
                  </div>
                </div>
                
                {result.txId && (
                  <div>
                    <div className="text-sm text-gray-400 mb-1">Transaction</div>
                    <a
                      href={getExplorerUrl(result.txId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-500 hover:underline"
                    >
                      View on WhatsOnChain →
                    </a>
                  </div>
                )}
              </div>

              {result.receiptHash && (
                <div className="border-t border-green-500/20 pt-4 mb-4">
                  <div className="text-sm text-gray-400 mb-1">Receipt Hash</div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs flex-1 truncate">{result.receiptHash}</code>
                    <CopyButton text={result.receiptHash} />
                  </div>
                </div>
              )}

              {receipt?.blockchainAnchor && (
                <div className="border-t border-green-500/20 pt-4 mb-4">
                  <div className="text-sm text-gray-400 mb-1">Blockchain Anchor</div>
                  <a
                    href={getExplorerUrl(receipt.blockchainAnchor)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-500 hover:underline"
                  >
                    {receipt.blockchainAnchor}
                  </a>
                </div>
              )}

              <div className="border-t border-green-500/20 pt-4">
                <div className="text-sm text-gray-400 mb-2">Output</div>
                <pre className="bg-[var(--bg)] rounded-lg p-4 overflow-x-auto text-sm">
                  {JSON.stringify(result.output, null, 2)}
                </pre>
              </div>
            </div>

            {/* Dispute Window Countdown */}
            {disputeWindowEnds && timeRemaining !== 'Expired' && (
              <div className="card bg-yellow-500/5 border-yellow-500/20">
                <div className="flex items-start gap-3 mb-4">
                  <span className="text-yellow-500 text-xl">⚖️</span>
                  <div>
                    <h3 className="font-semibold text-yellow-500 mb-1">Dispute Window Open</h3>
                    <p className="text-sm text-gray-400">
                      You have <span className="font-semibold text-yellow-500">{timeRemaining}</span> to open a dispute if needed
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="label">Reason</label>
                    <input
                      type="text"
                      value={disputeReason}
                      onChange={(e) => setDisputeReason(e.target.value)}
                      placeholder="Why are you disputing this payment?"
                      className="input"
                    />
                  </div>
                  
                  <div>
                    <label className="label">Evidence (optional)</label>
                    <textarea
                      value={disputeEvidence}
                      onChange={(e) => setDisputeEvidence(e.target.value)}
                      placeholder="Provide any supporting evidence..."
                      className="input"
                      rows={3}
                    />
                  </div>
                  
                  <button
                    onClick={handleOpenDispute}
                    disabled={!disputeReason.trim() || openingDispute}
                    className="btn btn-primary"
                  >
                    {openingDispute ? 'Opening Dispute...' : 'Open Dispute'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
