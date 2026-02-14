'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { formatDate, formatSats, formatCurrency } from '@/lib/utils'
import type { Dispute, Payment } from '@/lib/types'

export default function DisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [selectedPaymentId, setSelectedPaymentId] = useState('')
  const [loading, setLoading] = useState(true)
  const [walletId, setWalletId] = useState('')
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all')

  // Open dispute form
  const [disputeForm, setDisputeForm] = useState({
    reason: '',
    evidence: '',
  })

  const { toasts, success, error: showError, dismiss } = useToast()

  useEffect(() => {
    const stored = localStorage.getItem('agentpay_wallets')
    if (stored) {
      const ids = JSON.parse(stored)
      if (ids.length > 0) {
        setWalletId(ids[0])
      }
    }
  }, [])

  useEffect(() => {
    if (walletId) {
      loadDisputes()
    }
  }, [walletId])

  async function loadDisputes() {
    try {
      setLoading(true)
      const disps = await api.getDisputes(walletId)
      setDisputes(disps)
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleOpenDispute(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedPaymentId || !disputeForm.reason.trim()) {
      showError('Please select a payment and provide a reason')
      return
    }

    try {
      setLoading(true)
      await api.disputePayment(selectedPaymentId, disputeForm.reason, disputeForm.evidence || undefined)
      success('Dispute opened successfully')
      setDisputeForm({ reason: '', evidence: '' })
      setSelectedPaymentId('')
      await loadDisputes()
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const filteredDisputes = disputes.filter(d => {
    if (filter === 'all') return true
    if (filter === 'open') return d.status === 'open'
    return d.status !== 'open'
  })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
      case 'resolved_refund': return 'bg-red-500/10 text-red-500 border-red-500/20'
      case 'resolved_release': return 'bg-green-500/10 text-green-500 border-green-500/20'
      case 'resolved_partial': return 'bg-blue-500/10 text-blue-500 border-blue-500/20'
      default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20'
    }
  }

  if (!walletId) {
    return (
      <main className="min-h-screen py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="card text-center py-12">
            <h2 className="text-2xl font-bold mb-4">No Wallet Found</h2>
            <p className="text-gray-400 mb-6">
              You need to create a wallet first to manage disputes.
            </p>
            <a href="/wallet" className="btn btn-primary inline-flex">
              Go to Wallet
            </a>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen py-12 px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Dispute Management</h1>
          <p className="text-gray-400">Open and track payment disputes</p>
        </div>

        {/* Open Dispute Form */}
        <div className="card mb-8">
          <h2 className="text-xl font-semibold mb-4">Open New Dispute</h2>
          <form onSubmit={handleOpenDispute} className="space-y-4">
            <div>
              <label className="label">Payment ID</label>
              <input
                type="text"
                value={selectedPaymentId}
                onChange={(e) => setSelectedPaymentId(e.target.value)}
                className="input"
                placeholder="Enter payment ID to dispute"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                You can find the payment ID in your execution receipt
              </p>
            </div>

            <div>
              <label className="label">Reason</label>
              <input
                type="text"
                value={disputeForm.reason}
                onChange={(e) => setDisputeForm({ ...disputeForm, reason: e.target.value })}
                className="input"
                placeholder="Why are you disputing this payment?"
                required
              />
            </div>

            <div>
              <label className="label">Evidence (optional)</label>
              <textarea
                value={disputeForm.evidence}
                onChange={(e) => setDisputeForm({ ...disputeForm, evidence: e.target.value })}
                className="input"
                rows={4}
                placeholder="Provide any supporting evidence, logs, screenshots, etc."
              />
            </div>

            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? 'Opening Dispute...' : 'Open Dispute'}
            </button>
          </form>
        </div>

        {/* Filter */}
        <div className="card mb-6">
          <div className="flex gap-3">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded text-sm font-medium ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-[var(--bg)] text-gray-400'}`}
            >
              All ({disputes.length})
            </button>
            <button
              onClick={() => setFilter('open')}
              className={`px-4 py-2 rounded text-sm font-medium ${filter === 'open' ? 'bg-blue-500 text-white' : 'bg-[var(--bg)] text-gray-400'}`}
            >
              Open ({disputes.filter(d => d.status === 'open').length})
            </button>
            <button
              onClick={() => setFilter('resolved')}
              className={`px-4 py-2 rounded text-sm font-medium ${filter === 'resolved' ? 'bg-blue-500 text-white' : 'bg-[var(--bg)] text-gray-400'}`}
            >
              Resolved ({disputes.filter(d => d.status !== 'open').length})
            </button>
          </div>
        </div>

        {/* Disputes List */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Your Disputes</h2>
          
          {loading ? (
            <div className="text-center py-12 text-gray-400">
              Loading disputes...
            </div>
          ) : filteredDisputes.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              {filter === 'all' ? 'No disputes found' : `No ${filter} disputes`}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDisputes.map(dispute => (
                <div key={dispute.id} className="p-5 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold">{dispute.reason}</h3>
                        <span className={`px-3 py-1 text-xs font-medium border rounded ${getStatusColor(dispute.status)}`}>
                          {dispute.status.replace('_', ' ')}
                        </span>
                      </div>
                      
                      <div className="text-sm text-gray-400 space-y-1">
                        <div>
                          <span className="text-gray-500">Payment ID:</span>{' '}
                          <code className="text-xs">{dispute.paymentId}</code>
                        </div>
                        <div>
                          <span className="text-gray-500">Dispute ID:</span>{' '}
                          <code className="text-xs">{dispute.id}</code>
                        </div>
                        <div>
                          <span className="text-gray-500">Opened by:</span>{' '}
                          <code className="text-xs">{dispute.openedBy}</code>
                        </div>
                      </div>
                    </div>
                  </div>

                  {dispute.evidence && (
                    <div className="mb-3 p-3 bg-[var(--surface)] rounded border border-[var(--border)]">
                      <div className="text-xs text-gray-500 mb-1">Evidence</div>
                      <div className="text-sm text-gray-300">{dispute.evidence}</div>
                    </div>
                  )}

                  {dispute.resolution && (
                    <div className="mb-3 p-3 bg-green-500/5 rounded border border-green-500/20">
                      <div className="text-xs text-gray-500 mb-1">Resolution</div>
                      <div className="text-sm text-green-500">{dispute.resolution}</div>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-gray-500 pt-3 border-t border-[var(--border)]">
                    <div>
                      Opened {formatDate(dispute.createdAt)}
                    </div>
                    {dispute.resolvedAt && (
                      <div>
                        Resolved {formatDate(dispute.resolvedAt)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
