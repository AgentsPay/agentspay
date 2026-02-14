'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { CopyButton } from '@/components/CopyButton'
import { useToast } from '@/lib/useToast'
import { ToastContainer } from '@/components/Toast'
import { formatSats, formatDate, getExplorerUrl } from '@/lib/utils'

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

interface Attestation {
  id: string
  fromAddress: string
  toAddress: string
  score: number
  comment: string
  txid: string
  createdAt: string
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'

export default function IdentityPage() {
  const [identities, setIdentities] = useState<AgentIdentity[]>([])
  const [selectedIdentity, setSelectedIdentity] = useState<AgentIdentity | null>(null)
  const [attestations, setAttestations] = useState<Attestation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  // Register form
  const [showRegister, setShowRegister] = useState(false)
  const [regName, setRegName] = useState('')
  const [regType, setRegType] = useState<'human' | 'agent' | 'service'>('agent')
  const [regCapabilities, setRegCapabilities] = useState('')
  const [regAnchor, setRegAnchor] = useState(false)

  const { toasts, success, error: showError, dismiss } = useToast()

  useEffect(() => {
    loadIdentities()
  }, [search, typeFilter])

  async function loadIdentities() {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      if (typeFilter) params.set('type', typeFilter)
      const res = await fetch(`${API_URL}/api/identities?${params}`)
      const data = await res.json()
      setIdentities(data.identities || [])
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadIdentityDetail(address: string) {
    try {
      const res = await fetch(`${API_URL}/api/identity/${address}`)
      const data = await res.json()
      setSelectedIdentity(data.identity)
      setAttestations(data.attestations || [])
    } catch (err: any) {
      showError(err.message)
    }
  }

  async function handleRegister() {
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
      setShowRegister(false)
      setRegName('')
      setRegCapabilities('')
      loadIdentities()
    } catch (err: any) {
      showError(err.message)
    } finally {
      setLoading(false)
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

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500'
    if (score >= 60) return 'text-yellow-500'
    if (score >= 40) return 'text-orange-500'
    return 'text-red-500'
  }

  const renderStars = (score: number) => {
    const stars = Math.round(score / 20)
    return '★'.repeat(stars) + '☆'.repeat(5 - stars)
  }

  return (
    <main className="min-h-screen py-12 px-4 sm:px-6">
      <ToastContainer toasts={toasts} onDismiss={dismiss} />

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-2">Agent Identity</h1>
            <p className="text-gray-400">On-chain identity & reputation for AI agents (ERC-8004 equivalent on BSV)</p>
          </div>
          <button
            onClick={() => setShowRegister(!showRegister)}
            className="btn btn-primary text-sm"
          >
            {showRegister ? 'Cancel' : '+ Register Identity'}
          </button>
        </div>

        {/* Register Form */}
        {showRegister && (
          <div className="card mb-6">
            <h2 className="text-xl font-semibold mb-4">Register New Identity</h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
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
            <div className="mb-4">
              <label className="label">Capabilities (comma-separated)</label>
              <input
                value={regCapabilities}
                onChange={e => setRegCapabilities(e.target.value)}
                placeholder="security-scanning, data-analysis, code-review"
                className="input w-full"
              />
            </div>
            <div className="flex items-center gap-4 mb-4">
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
            <button onClick={handleRegister} disabled={loading || !regName.trim()} className="btn btn-primary">
              {loading ? 'Registering...' : 'Register Identity'}
            </button>
          </div>
        )}

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="input flex-1"
          />
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input sm:w-40">
            <option value="">All Types</option>
            <option value="agent">🤖 Agents</option>
            <option value="human">👤 Humans</option>
            <option value="service">⚙️ Services</option>
          </select>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Identity List */}
          <div className="lg:col-span-2 space-y-3">
            {loading && identities.length === 0 ? (
              <div className="text-center py-12 text-gray-400">Loading identities...</div>
            ) : identities.length === 0 ? (
              <div className="card text-center py-12">
                <div className="text-5xl mb-4">🆔</div>
                <h3 className="text-xl font-semibold mb-2">No Identities Yet</h3>
                <p className="text-gray-400 mb-4">Register the first agent identity on the network</p>
                <button onClick={() => setShowRegister(true)} className="btn btn-primary">
                  + Register Identity
                </button>
              </div>
            ) : (
              identities.map(identity => (
                <div
                  key={identity.id}
                  onClick={() => loadIdentityDetail(identity.address)}
                  className={`card cursor-pointer transition-all hover:border-blue-500/30 ${
                    selectedIdentity?.id === identity.id ? 'border-blue-500/50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold">{identity.displayName}</h3>
                        {getTypeBadge(identity.type)}
                      </div>
                      <code className="text-xs text-gray-500">{identity.address}</code>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${getScoreColor(identity.reputation.score)}`}>
                        {identity.reputation.score}
                      </div>
                      <div className="text-xs text-gray-500">reputation</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {identity.capabilities.slice(0, 4).map(cap => (
                      <span key={cap} className="px-2 py-0.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-full text-gray-400">
                        {cap}
                      </span>
                    ))}
                    {identity.capabilities.length > 4 && (
                      <span className="text-xs text-gray-500">+{identity.capabilities.length - 4} more</span>
                    )}
                  </div>

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
                    <div className="mt-3 pt-3 border-t border-[var(--border)] text-xs">
                      <span className="text-green-500">✓ On-chain</span>
                      {' · '}
                      <a href={getExplorerUrl(identity.onChainTxId)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                        {identity.onChainTxId.slice(0, 16)}...
                      </a>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-1">
            {selectedIdentity ? (
              <div className="card sticky top-20">
                <h3 className="text-lg font-semibold mb-1">{selectedIdentity.displayName}</h3>
                {getTypeBadge(selectedIdentity.type)}

                {/* Reputation Ring */}
                <div className="flex flex-col items-center my-6">
                  <div className={`text-5xl font-bold ${getScoreColor(selectedIdentity.reputation.score)}`}>
                    {selectedIdentity.reputation.score}
                  </div>
                  <div className="text-yellow-500 text-lg tracking-wider mt-1">
                    {renderStars(selectedIdentity.reputation.score)}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">Reputation Score</div>
                </div>

                {/* Stats */}
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Transactions</span>
                    <span className="font-medium">{selectedIdentity.reputation.totalTransactions}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Success Rate</span>
                    <span className="font-medium">{(selectedIdentity.reputation.successRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Volume</span>
                    <span className="font-medium">{formatSats(selectedIdentity.reputation.totalVolumeSats)} sats</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Attestations</span>
                    <span className="font-medium">{selectedIdentity.reputation.attestations}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Registered</span>
                    <span className="font-medium">{formatDate(selectedIdentity.registeredAt)}</span>
                  </div>
                </div>

                {/* Address */}
                <div className="mb-4">
                  <div className="text-xs text-gray-500 mb-1">BSV Address</div>
                  <div className="flex items-center gap-2">
                    <code className="text-xs flex-1 truncate">{selectedIdentity.address}</code>
                    <CopyButton text={selectedIdentity.address} />
                  </div>
                </div>

                {/* Capabilities */}
                {selectedIdentity.capabilities.length > 0 && (
                  <div className="mb-4">
                    <div className="text-xs text-gray-500 mb-2">Capabilities</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedIdentity.capabilities.map(cap => (
                        <span key={cap} className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Attestations */}
                {attestations.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Recent Reviews</div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {attestations.map(att => (
                        <div key={att.id} className="p-2 bg-[var(--bg)] rounded-lg text-xs">
                          <div className="flex justify-between mb-1">
                            <span className="text-yellow-500">{'★'.repeat(att.score)}{'☆'.repeat(5 - att.score)}</span>
                            <span className="text-gray-500">{formatDate(att.createdAt)}</span>
                          </div>
                          {att.comment && <p className="text-gray-400">{att.comment}</p>}
                          <code className="text-gray-600 text-[10px]">{att.fromAddress.slice(0, 12)}...</code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="card text-center py-8 text-gray-400 sticky top-20">
                <div className="text-3xl mb-3">👈</div>
                <p className="text-sm">Select an identity to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
