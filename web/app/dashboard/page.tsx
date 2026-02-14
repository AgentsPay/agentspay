'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { PaymentStatus } from '@/components/PaymentStatus'
import { ReputationStars } from '@/components/ReputationStars'
import { CATEGORIES } from '@/lib/utils'
import { formatSats, formatDate } from '@/lib/utils'
import type { Service, Reputation, Payment } from '@/lib/types'

export default function DashboardPage() {
  const [agentWalletId, setAgentWalletId] = useState('')
  const [services, setServices] = useState<Service[]>([])
  const [reputation, setReputation] = useState<Reputation | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'services' | 'payments'>('services')

  const { toasts, success, error: showError, dismiss } = useToast()

  // Register Service Form
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'utility',
    price: '1000',
    endpoint: '',
    method: 'POST',
  })

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
      const allServices = await api.getServices()
      const myServices = allServices.filter(s => s.agentId === agentWalletId)
      setServices(myServices)

      const rep = await api.getReputation(agentWalletId)
      setReputation(rep)
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
        endpoint: formData.endpoint,
        method: formData.method,
      })
      success('Service registered successfully!')
      setFormData({
        name: '',
        description: '',
        category: 'utility',
        price: '1000',
        endpoint: '',
        method: 'POST',
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
        <div className="grid md:grid-cols-3 gap-5 mb-8">
          <div className="card">
            <div className="text-sm text-gray-400 mb-1">Agent ID</div>
            <div className="font-mono text-sm truncate">{agentWalletId}</div>
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

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="label">Price (satoshis)</label>
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
              onClick={() => setView('payments')}
              className={`font-semibold ${view === 'payments' ? 'text-blue-500' : 'text-gray-400'}`}
            >
              Payments
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
                            {formatSats(service.price)} sats
                          </div>
                          <span className="text-xs text-gray-500">{service.category}</span>
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

          {view === 'payments' && (
            <div className="text-center py-8 text-gray-400">
              Payment history coming soon
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
