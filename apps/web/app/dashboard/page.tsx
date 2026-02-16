'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { PaymentStatus } from '@/components/PaymentStatus'
import { ReputationStars } from '@/components/ReputationStars'
import { CopyButton } from '@/components/CopyButton'
import { CATEGORIES } from '@/lib/utils'
import { formatSats, formatDate, formatCurrency, satsToUsd, getExplorerUrl } from '@/lib/utils'
import { useBsvPrice } from '@/lib/useBsvPrice'
import type { Service, Reputation, Payment, Webhook, Dispute, Receipt, Wallet, Execution } from '@/lib/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'

// Identity types (inline — adapted from standalone page)
interface AgentIdentity {
  id: string
  address: string
  displayName: string
  type: 'human' | 'agent' | 'service'
  capabilities: string[]
  metadata: Record<string, any>
  reputation: {
    score: number
    totalTransactions: number
    successRate: number
    totalVolumeSats: number
    attestations: number
  }
  registeredAt: string
  lastUpdated: string
  onChainTxId: string | null
}

type DashboardTab = 'services' | 'executions' | 'disputes' | 'webhooks' | 'identity'

export default function DashboardPage() {
  const [agentWalletId, setAgentWalletId] = useState('')
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [reputation, setReputation] = useState<Reputation | null>(null)
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [executions, setExecutions] = useState<Execution[]>([])
  const [executionsTotal, setExecutionsTotal] = useState(0)
  const [executionsOffset, setExecutionsOffset] = useState(0)
  const [identities, setIdentities] = useState<AgentIdentity[]>([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<DashboardTab>('services')

  const bsvPrice = useBsvPrice()
  const { toasts, success, error: showError, dismiss } = useToast()

  // Register Service Form
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'utility',
    price: '1000',
    currency: 'BSV' as 'BSV' | 'MNEE',
    timeout: '30',
    disputeWindow: '30',
  })

  // Webhook Form
  const [webhookForm, setWebhookForm] = useState({
    url: '',
    events: [] as string[],
  })

  // Identity Register Form
  const [regName, setRegName] = useState('')
  const [regType, setRegType] = useState<'human' | 'agent' | 'service'>('agent')
  const [regCapabilities, setRegCapabilities] = useState('')
  const [regAnchor, setRegAnchor] = useState(false)

  const WEBHOOK_EVENTS = [
    'payment.escrowed',
    'payment.released',
    'payment.refunded',
    'payment.disputed',
    'service.executed',
  ]

  useEffect(() => {
    const stored = localStorage.getItem('agentpay_wallets')
    if (stored) {
      const ids = JSON.parse(stored)
      if (ids.length > 0) {
        setAgentWalletId(ids[0])
      }
    }
  }, [])

  useEffect(() => {
    if (agentWalletId) {
      loadDashboardData()
    }
  }, [agentWalletId])

  async function loadDashboardData() {
    try {
      setLoading(true)
      const [allServices, rep, w] = await Promise.all([
        api.getServices(),
        api.getReputation(agentWalletId).catch(() => null),
        api.getWallet(agentWalletId).catch(() => null),
      ])

      const myServices = allServices.filter(s => s.agentId === agentWalletId)
      setServices(myServices)
      setReputation(rep)
      setWallet(w)

      // Load webhooks
      try {
        const whs = await api.getWebhooks(agentWalletId)
        setWebhooks(whs)
      } catch (err) {}

      // Load disputes
      try {
        const disps = await api.getDisputes(agentWalletId)
        setDisputes(disps)
      } catch (err) {}

      // Load executions
      try {
        const exData = await api.getExecutions(agentWalletId, { limit: 20, offset: 0 })
        setExecutions(exData.executions)
        setExecutionsTotal(exData.total)
        setExecutionsOffset(0)
      } catch (err) {}

      // Load identities
      try {
        const res = await fetch(`${API_URL}/api/identities`, { credentials: 'include' })
        const data = await res.json()
        setIdentities(data.identities || [])
      } catch (err) {}
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadMoreExecutions(newOffset: number) {
    try {
      const exData = await api.getExecutions(agentWalletId, { limit: 20, offset: newOffset })
      setExecutions(exData.executions)
      setExecutionsTotal(exData.total)
      setExecutionsOffset(newOffset)
    } catch (err: any) {
      showError(err.message)
    }
  }

  async function handleRegisterService(e: React.FormEvent) {
    e.preventDefault()
    if (!agentWalletId) {
      showError('Please select an agent wallet first')
      return
    }

    try {
      setLoading(true)
      await api.registerService({
        agentId: agentWalletId,
        name: formData.name,
        description: formData.description,
        category: formData.category,
        price: Number(formData.price),
        currency: formData.currency,
        timeout: Number(formData.timeout),
        disputeWindow: Number(formData.disputeWindow),
      } as any)
      success('Service registered successfully!')
      setFormData({
        name: '',
        description: '',
        category: 'utility',
        price: '1000',
        currency: 'BSV',
        timeout: '30',
        disputeWindow: '30',
      })
      await loadDashboardData()
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleService(serviceId: string, currentActive: boolean) {
    try {
      await api.updateService(serviceId, { active: !currentActive })
      success(`Service ${currentActive ? 'deactivated' : 'activated'}`)
      await loadDashboardData()
    } catch (err: any) {
      showError(err.message)
    }
  }

  async function handleCreateWebhook(e: React.FormEvent) {
    e.preventDefault()
    if (!webhookForm.url || webhookForm.events.length === 0) {
      showError('Please provide URL and at least one event')
      return
    }

    try {
      setLoading(true)
      await api.createWebhook(agentWalletId, webhookForm.url, webhookForm.events)
      success('Webhook created successfully!')
      setWebhookForm({ url: '', events: [] })
      await loadDashboardData()
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteWebhook(id: string) {
    if (!confirm('Delete this webhook?')) return

    try {
      await api.deleteWebhook(id)
      success('Webhook deleted')
      await loadDashboardData()
    } catch (err: any) {
      showError(err.message)
    }
  }

  async function handleRegisterIdentity() {
    if (!regName.trim()) return showError('Display name required')
    try {
      setLoading(true)
      const res = await fetch(`${API_URL}/api/identity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          displayName: regName,
          type: regType,
          capabilities: regCapabilities.split(',').map(s => s.trim()).filter(Boolean),
          anchorOnChain: regAnchor,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      success('Identity registered!')
      setRegName('')
      setRegCapabilities('')
      setRegAnchor(false)
      await loadDashboardData()
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleEvent = (event: string) => {
    setWebhookForm(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }))
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      released: 'bg-green-500/10 text-green-500',
      escrowed: 'bg-blue-500/10 text-blue-500',
      refunded: 'bg-red-500/10 text-red-500',
      disputed: 'bg-yellow-500/10 text-yellow-500',
      pending: 'bg-gray-500/10 text-gray-400',
    }
    return (
      <span className={`px-2 py-0.5 text-xs rounded ${styles[status] || styles.pending}`}>
        {status}
      </span>
    )
  }

  const getDisputeStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-yellow-500/10 text-yellow-500'
      case 'resolved_refund': return 'bg-red-500/10 text-red-500'
      case 'resolved_release': return 'bg-green-500/10 text-green-500'
      case 'resolved_split': return 'bg-blue-500/10 text-blue-500'
      default: return 'bg-gray-500/10 text-gray-400'
    }
  }

  const getTypeBadge = (type: string) => {
    const styles: Record<string, string> = {
      human: 'bg-green-500/10 text-green-400 border-green-500/20',
      agent: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      service: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    }
    const icons: Record<string, string> = { human: '👤', agent: '🤖', service: '⚙️' }
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded ${styles[type] || styles.agent}`}>
        {icons[type]} {type}
      </span>
    )
  }

  if (!agentWalletId) {
    return (
      <main className="min-h-screen py-12 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="card text-center py-12">
            <h2 className="text-2xl font-bold mb-4">No Wallet Found</h2>
            <p className="text-gray-400 mb-6">
              You need to create a wallet first to use the dashboard.
            </p>
            <a href="/wallet" className="btn btn-primary inline-flex">
              Go to Wallet
            </a>
          </div>
        </div>
      </main>
    )
  }

  const TABS: { key: DashboardTab; label: string; count: number }[] = [
    { key: 'services', label: 'My Services', count: services.length },
    { key: 'executions', label: 'My Executions', count: executionsTotal },
    { key: 'disputes', label: 'Disputes', count: disputes.length },
    { key: 'webhooks', label: 'Webhooks', count: webhooks.length },
    { key: 'identity', label: 'Identity', count: identities.length },
  ]

  return (
    <main className="min-h-screen py-12 px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Agent Dashboard</h1>
          <p className="text-gray-400">Manage your services and track earnings</p>
        </div>

        {/* Analytics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5 mb-8">
          <div className="card">
            <div className="text-xs sm:text-sm text-gray-400 mb-1">💰 Revenue</div>
            <div className="text-xl sm:text-2xl font-bold text-green-500">
              {wallet?.balances ? formatSats(wallet.balances.BSV.amount) : '0'} <span className="text-sm text-gray-500">sats</span>
            </div>
            {wallet?.balances && bsvPrice && (
              <div className="text-xs text-gray-400 mt-1">
                ≈ {satsToUsd(wallet.balances.BSV.amount, bsvPrice)}
              </div>
            )}
          </div>

          <div className="card">
            <div className="text-xs sm:text-sm text-gray-400 mb-1">📦 Services</div>
            <div className="text-xl sm:text-2xl font-bold">{services.length}</div>
            <div className="text-xs text-gray-400 mt-1">
              {services.filter(s => s.active).length} active
            </div>
          </div>

          <div className="card">
            <div className="text-xs sm:text-sm text-gray-400 mb-1">⭐ Reputation</div>
            {reputation ? (
              <>
                <div className="text-xl sm:text-2xl font-bold">
                  {(reputation.successRate * 100).toFixed(0)}%
                </div>
                <ReputationStars successRate={reputation.successRate} size="sm" />
                <div className="text-xs text-gray-400 mt-1">
                  {reputation.totalJobs} jobs
                </div>
              </>
            ) : (
              <div className="text-xl font-bold text-gray-500">—</div>
            )}
          </div>

          <div className="card">
            <div className="text-xs sm:text-sm text-gray-400 mb-1">⚖️ Disputes</div>
            <div className="text-xl sm:text-2xl font-bold">
              {disputes.filter(d => d.status === 'open').length}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {disputes.length} total
            </div>
          </div>
        </div>

        {/* Revenue Bar Chart (CSS-only) */}
        {services.length > 0 && (
          <div className="card mb-8">
            <h2 className="text-lg font-semibold mb-4">Service Pricing Overview</h2>
            <div className="space-y-3">
              {services.map(service => {
                const maxPrice = Math.max(...services.map(s => s.price), 1)
                const widthPercent = Math.max((service.price / maxPrice) * 100, 5)
                return (
                  <div key={service.id} className="flex items-center gap-3">
                    <div className="w-28 sm:w-36 text-sm text-gray-400 truncate flex-shrink-0">{service.name}</div>
                    <div className="flex-1 bg-[var(--bg)] rounded-full h-6 overflow-hidden">
                      <div
                        className={`h-full rounded-full flex items-center px-2 text-xs font-medium text-white ${
                          service.active ? 'bg-gradient-to-r from-blue-600 to-blue-400' : 'bg-gray-600'
                        }`}
                        style={{ width: `${widthPercent}%`, minWidth: 'fit-content' }}
                      >
                        {service.currency === 'BSV' ? `${formatSats(service.price)} sats` : formatCurrency(service.price, service.currency)}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 w-16 text-right flex-shrink-0">
                      {service.currency === 'BSV' && bsvPrice ? satsToUsd(service.price, bsvPrice) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Quick Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-500">{webhooks.length}</div>
            <div className="text-xs text-gray-400">Webhooks</div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-500">{services.filter(s => s.currency === 'BSV').length}</div>
            <div className="text-xs text-gray-400">BSV Services</div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-green-500">{services.filter(s => s.currency === 'MNEE').length}</div>
            <div className="text-xs text-gray-400">MNEE Services</div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-orange-500">{bsvPrice ? `$${bsvPrice.toFixed(2)}` : '—'}</div>
            <div className="text-xs text-gray-400">BSV/USD</div>
          </div>
        </div>

        {/* Register Service Form */}
        <div className="card mb-8">
          <h2 className="text-xl font-semibold mb-4">Register New Service</h2>
          <form onSubmit={handleRegisterService} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Service Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="input"
                  required
                  placeholder="e.g., VulnScanner"
                />
              </div>

              <div>
                <label className="label">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="input"
                  required
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="input"
                rows={3}
                required
                placeholder="What does your service do?"
              />
            </div>

            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="label">Currency</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value as 'BSV' | 'MNEE' })}
                  className="input"
                  required
                >
                  <option value="BSV">BSV</option>
                  <option value="MNEE">MNEE</option>
                </select>
              </div>

              <div>
                <label className="label">Price ({formData.currency === 'BSV' ? 'sats' : 'cents'})</label>
                <input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  className="input"
                  required
                  min="1"
                />
              </div>

              <div>
                <label className="label">Timeout (seconds)</label>
                <input
                  type="number"
                  value={formData.timeout}
                  onChange={(e) => setFormData({ ...formData, timeout: e.target.value })}
                  className="input"
                  required
                  min="1"
                />
              </div>

              <div>
                <label className="label">Dispute Window (minutes)</label>
                <input
                  type="number"
                  value={formData.disputeWindow}
                  onChange={(e) => setFormData({ ...formData, disputeWindow: e.target.value })}
                  className="input"
                  required
                  min="1"
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? 'Registering...' : 'Register Service'}
            </button>
          </form>
        </div>

        {/* Tabs — 5 tabs with horizontal scroll on mobile */}
        <div className="card">
          <div className="flex gap-4 mb-6 border-b border-[var(--border)] pb-3 overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setView(tab.key)}
                className={`font-semibold whitespace-nowrap ${view === tab.key ? 'text-blue-500' : 'text-gray-400'}`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Services Tab */}
          {view === 'services' && (
            <div>
              {services.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No services registered yet
                </div>
              ) : (
                <div className="space-y-3">
                  {services.map(service => (
                    <div key={service.id} className="p-4 bg-[var(--bg)] rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold mb-1">{service.name}</h3>
                          <p className="text-sm text-gray-400">{service.description}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-green-500">
                            {service.currency === 'BSV' ? `${formatSats(service.price)} sats` : formatCurrency(service.price, service.currency)}
                          </div>
                          <span className="text-xs text-gray-500">{service.category} • {service.currency}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleToggleService(service.id, service.active)}
                          className={`text-xs px-3 py-1 rounded ${
                            service.active
                              ? 'bg-green-500/10 text-green-500'
                              : 'bg-gray-500/10 text-gray-400'
                          }`}
                        >
                          {service.active ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Executions Tab */}
          {view === 'executions' && (
            <div>
              {executions.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No executions yet. Execute a service from the marketplace to see your history here.
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {executions.map(exec => (
                      <div key={exec.paymentId} className="p-4 bg-[var(--bg)] rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold mb-1">{exec.serviceName || 'Unknown Service'}</h3>
                            <div className="text-xs text-gray-500">
                              {formatDate(exec.createdAt)}
                              {exec.executionTimeMs && ` • ${exec.executionTimeMs}ms`}
                            </div>
                          </div>
                          <div className="text-right flex items-center gap-2">
                            <div className="text-lg font-bold text-green-500">
                              {exec.currency === 'BSV' ? `${formatSats(exec.amount)} sats` : formatCurrency(exec.amount, exec.currency)}
                            </div>
                            {getStatusBadge(exec.status)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>Payment: <code>{exec.paymentId.slice(0, 12)}...</code></span>
                          {exec.receiptHash && (
                            <span className="text-green-500">✓ Receipt</span>
                          )}
                          {exec.disputeId && (
                            <span className={exec.disputeStatus === 'open' ? 'text-yellow-500' : 'text-red-500'}>
                              ⚖️ {exec.disputeStatus}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination */}
                  {executionsTotal > 20 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)]">
                      <button
                        onClick={() => loadMoreExecutions(Math.max(0, executionsOffset - 20))}
                        disabled={executionsOffset === 0}
                        className="text-sm text-blue-500 disabled:text-gray-500"
                      >
                        ← Previous
                      </button>
                      <span className="text-xs text-gray-500">
                        {executionsOffset + 1}–{Math.min(executionsOffset + 20, executionsTotal)} of {executionsTotal}
                      </span>
                      <button
                        onClick={() => loadMoreExecutions(executionsOffset + 20)}
                        disabled={executionsOffset + 20 >= executionsTotal}
                        className="text-sm text-blue-500 disabled:text-gray-500"
                      >
                        Next →
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Disputes Tab */}
          {view === 'disputes' && (
            <div>
              {disputes.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No disputes found
                </div>
              ) : (
                <div className="space-y-3">
                  {disputes.map(dispute => (
                    <div key={dispute.id} className="p-4 bg-[var(--bg)] rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="font-semibold mb-1">{dispute.reason}</div>
                          <div className="text-sm text-gray-400">Payment: {dispute.paymentId}</div>
                        </div>
                        <span className={`px-3 py-1 text-xs rounded ${getDisputeStatusColor(dispute.status)}`}>
                          {dispute.status.replace('_', ' ')}
                        </span>
                      </div>
                      {dispute.evidence && (
                        <div className="text-xs text-gray-500 mt-2">
                          Evidence: {dispute.evidence}
                        </div>
                      )}
                      {dispute.resolution && (
                        <div className="mt-2 p-2 bg-green-500/5 rounded border border-green-500/20 text-xs text-green-500">
                          Resolution: {dispute.resolution}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-2">
                        Opened {formatDate(dispute.createdAt)}
                        {dispute.resolvedAt && ` • Resolved ${formatDate(dispute.resolvedAt)}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Webhooks Tab */}
          {view === 'webhooks' && (
            <div>
              {/* Create Webhook Form */}
              <form onSubmit={handleCreateWebhook} className="mb-6 p-4 bg-[var(--bg)] rounded-lg">
                <h3 className="font-semibold mb-3">Add New Webhook</h3>

                <div className="mb-3">
                  <label className="label">Webhook URL</label>
                  <input
                    type="url"
                    value={webhookForm.url}
                    onChange={(e) => setWebhookForm({ ...webhookForm, url: e.target.value })}
                    className="input"
                    placeholder="https://your-server.com/webhook"
                    required
                  />
                </div>

                <div className="mb-3">
                  <label className="label">Events</label>
                  <div className="space-y-2">
                    {WEBHOOK_EVENTS.map(event => (
                      <label key={event} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={webhookForm.events.includes(event)}
                          onChange={() => toggleEvent(event)}
                          className="rounded"
                        />
                        <span className="text-sm">{event}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary text-sm">
                  Add Webhook
                </button>
              </form>

              {/* Webhook List */}
              {webhooks.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No webhooks configured
                </div>
              ) : (
                <div className="space-y-3">
                  {webhooks.map(webhook => (
                    <div key={webhook.id} className="p-4 bg-[var(--bg)] rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <code className="text-sm text-blue-500 break-all">{webhook.url}</code>
                          <div className="text-xs text-gray-500 mt-1">
                            Events: {webhook.events.join(', ')}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteWebhook(webhook.id)}
                          className="text-xs text-red-500 hover:underline ml-3"
                        >
                          Delete
                        </button>
                      </div>
                      <div className="text-xs text-gray-500">
                        Created {formatDate(webhook.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Identity Tab */}
          {view === 'identity' && (
            <div>
              {/* Inline Register Form */}
              <div className="mb-6 p-4 bg-[var(--bg)] rounded-lg">
                <h3 className="font-semibold mb-3">Register Identity</h3>
                <div className="grid sm:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="label">Display Name *</label>
                    <input
                      value={regName}
                      onChange={e => setRegName(e.target.value)}
                      placeholder="My AI Agent"
                      className="input w-full"
                    />
                  </div>
                  <div>
                    <label className="label">Type</label>
                    <select value={regType} onChange={e => setRegType(e.target.value as any)} className="input w-full">
                      <option value="agent">🤖 Agent</option>
                      <option value="human">👤 Human</option>
                      <option value="service">⚙️ Service</option>
                    </select>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="label">Capabilities (comma-separated)</label>
                  <input
                    value={regCapabilities}
                    onChange={e => setRegCapabilities(e.target.value)}
                    placeholder="security-scanning, data-analysis, code-review"
                    className="input w-full"
                  />
                </div>
                <div className="flex items-center gap-4 mb-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={regAnchor}
                      onChange={e => setRegAnchor(e.target.checked)}
                      className="rounded"
                    />
                    <span>Anchor on BSV blockchain (OP_RETURN)</span>
                  </label>
                </div>
                <button onClick={handleRegisterIdentity} disabled={loading || !regName.trim()} className="btn btn-primary text-sm">
                  {loading ? 'Registering...' : 'Register Identity'}
                </button>
              </div>

              {/* Identity List */}
              {identities.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No identities registered yet
                </div>
              ) : (
                <div className="space-y-3">
                  {identities.map(identity => (
                    <div key={identity.id} className="p-4 bg-[var(--bg)] rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold">{identity.displayName}</h3>
                            {getTypeBadge(identity.type)}
                          </div>
                          <code className="text-xs text-gray-500">{identity.address}</code>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-blue-500">
                            {identity.reputation.score}
                          </div>
                          <div className="text-xs text-gray-500">reputation</div>
                        </div>
                      </div>

                      {identity.capabilities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {identity.capabilities.slice(0, 4).map(cap => (
                            <span key={cap} className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">
                              {cap}
                            </span>
                          ))}
                          {identity.capabilities.length > 4 && (
                            <span className="text-xs text-gray-500">+{identity.capabilities.length - 4} more</span>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-4 gap-3 text-center text-xs">
                        <div>
                          <div className="font-semibold text-white">{identity.reputation.totalTransactions}</div>
                          <div className="text-gray-500">txns</div>
                        </div>
                        <div>
                          <div className="font-semibold text-white">{(identity.reputation.successRate * 100).toFixed(0)}%</div>
                          <div className="text-gray-500">success</div>
                        </div>
                        <div>
                          <div className="font-semibold text-white">{formatSats(identity.reputation.totalVolumeSats)}</div>
                          <div className="text-gray-500">sats vol</div>
                        </div>
                        <div>
                          <div className="font-semibold text-white">{identity.reputation.attestations}</div>
                          <div className="text-gray-500">reviews</div>
                        </div>
                      </div>

                      {identity.onChainTxId && (
                        <div className="mt-2 pt-2 border-t border-[var(--border)] text-xs">
                          <span className="text-green-500">✓ On-chain</span>
                          {' · '}
                          <a href={getExplorerUrl(identity.onChainTxId)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                            {identity.onChainTxId.slice(0, 16)}...
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
