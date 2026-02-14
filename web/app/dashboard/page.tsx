'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { PaymentStatus } from '@/components/PaymentStatus'
import { ReputationStars } from '@/components/ReputationStars'
import { CATEGORIES } from '@/lib/utils'
import { formatSats, formatDate, formatCurrency } from '@/lib/utils'
import type { Service, Reputation, Payment, Webhook, Dispute, Receipt, Wallet } from '@/lib/types'

export default function DashboardPage() {
  const [agentWalletId, setAgentWalletId] = useState('')
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [reputation, setReputation] = useState<Reputation | null>(null)
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'services' | 'webhooks' | 'disputes'>('services')

  const { toasts, success, error: showError, dismiss } = useToast()

  // Register Service Form
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'utility',
    price: '1000',
    currency: 'BSV' as 'BSV' | 'MNEE',
    endpoint: '',
    method: 'POST',
    timeoutMs: '30000',
    disputeWindowMs: '1800000', // 30 min
  })

  // Webhook Form
  const [webhookForm, setWebhookForm] = useState({
    url: '',
    events: [] as string[],
  })

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
      } catch (err) {
        // Webhooks might not be available
      }

      // Load disputes
      try {
        const disps = await api.getDisputes(agentWalletId)
        setDisputes(disps)
      } catch (err) {
        // Disputes might not be available
      }
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
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
        endpoint: formData.endpoint,
        method: formData.method,
        timeoutMs: Number(formData.timeoutMs),
        disputeWindowMs: Number(formData.disputeWindowMs),
      })
      success('Service registered successfully!')
      setFormData({
        name: '',
        description: '',
        category: 'utility',
        price: '1000',
        currency: 'BSV',
        endpoint: '',
        method: 'POST',
        timeoutMs: '30000',
        disputeWindowMs: '1800000',
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

  const toggleEvent = (event: string) => {
    setWebhookForm(prev => ({
      ...prev,
      events: prev.events.includes(event)
        ? prev.events.filter(e => e !== event)
        : [...prev.events, event]
    }))
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

  return (
    <main className="min-h-screen py-12 px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Agent Dashboard</h1>
          <p className="text-gray-400">Manage your services and track earnings</p>
        </div>

        {/* Agent Info */}
        <div className="grid md:grid-cols-4 gap-5 mb-8">
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Agent ID</div>
            <div className="font-mono text-xs truncate">{agentWalletId}</div>
          </div>
          
          {reputation && (
            <>
              <div className="card">
                <div className="text-sm text-gray-400 mb-1">Total Services</div>
                <div className="text-2xl font-bold">{reputation.totalServices}</div>
              </div>
              
              <div className="card">
                <div className="text-sm text-gray-400 mb-1">Success Rate</div>
                <ReputationStars successRate={reputation.successRate} size="lg" />
              </div>
            </>
          )}

          {wallet?.balances && (
            <div className="card">
              <div className="text-sm text-gray-400 mb-1">Balances</div>
              <div className="text-sm">
                <div className="text-green-500">{formatSats(wallet.balances.BSV)} sats</div>
                <div className="text-blue-500">{formatCurrency(wallet.balances.MNEE, 'MNEE')}</div>
              </div>
            </div>
          )}
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
                <label className="label">Timeout (ms)</label>
                <input
                  type="number"
                  value={formData.timeoutMs}
                  onChange={(e) => setFormData({ ...formData, timeoutMs: e.target.value })}
                  className="input"
                  required
                  min="1000"
                />
              </div>
              
              <div>
                <label className="label">Dispute Window (ms)</label>
                <input
                  type="number"
                  value={formData.disputeWindowMs}
                  onChange={(e) => setFormData({ ...formData, disputeWindowMs: e.target.value })}
                  className="input"
                  required
                  min="60000"
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">HTTP Method</label>
                <select
                  value={formData.method}
                  onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                  className="input"
                  required
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              
              <div>
                <label className="label">Endpoint URL</label>
                <input
                  type="url"
                  value={formData.endpoint}
                  onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                  className="input"
                  required
                  placeholder="https://..."
                />
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn btn-primary">
              {loading ? 'Registering...' : 'Register Service'}
            </button>
          </form>
        </div>

        {/* Tabs */}
        <div className="card">
          <div className="flex gap-4 mb-6 border-b border-[var(--border)] pb-3">
            <button
              onClick={() => setView('services')}
              className={`font-semibold ${view === 'services' ? 'text-blue-500' : 'text-gray-400'}`}
            >
              My Services ({services.length})
            </button>
            <button
              onClick={() => setView('webhooks')}
              className={`font-semibold ${view === 'webhooks' ? 'text-blue-500' : 'text-gray-400'}`}
            >
              Webhooks ({webhooks.length})
            </button>
            <button
              onClick={() => setView('disputes')}
              className={`font-semibold ${view === 'disputes' ? 'text-blue-500' : 'text-gray-400'}`}
            >
              Disputes ({disputes.length})
            </button>
          </div>

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
                        <code className="text-xs text-gray-500 flex-1 truncate">{service.endpoint}</code>
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
                        <div className={`px-3 py-1 text-xs rounded ${
                          dispute.status === 'open' ? 'bg-yellow-500/10 text-yellow-500' :
                          dispute.status === 'resolved_refund' ? 'bg-red-500/10 text-red-500' :
                          dispute.status === 'resolved_release' ? 'bg-green-500/10 text-green-500' :
                          'bg-blue-500/10 text-blue-500'
                        }`}>
                          {dispute.status}
                        </div>
                      </div>
                      {dispute.evidence && (
                        <div className="text-xs text-gray-500 mt-2">
                          Evidence: {dispute.evidence}
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
        </div>
      </div>
    </main>
  )
}
