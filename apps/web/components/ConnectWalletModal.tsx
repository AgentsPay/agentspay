'use client'

import { useState } from 'react'

type Provider = 'internal' | 'handcash' | 'yours' | 'import'

interface ConnectWalletModalProps {
  open: boolean
  onClose: () => void
  onConnect: (provider: Provider, data?: { privateKey?: string }) => Promise<void>
  loading: boolean
}

const providers = [
  {
    id: 'internal' as Provider,
    name: 'Create New Wallet',
    icon: '⚡',
    description: 'Generate keys instantly',
    tag: 'Recommended',
    tagColor: 'bg-green-500/20 text-green-400',
    available: true,
  },
  {
    id: 'yours' as Provider,
    name: 'Yours Wallet',
    icon: '👛',
    description: 'Browser extension',
    tag: null,
    tagColor: '',
    available: typeof window !== 'undefined' && !!((window as any).yours || (window as any).panda),
  },
  {
    id: 'handcash' as Provider,
    name: 'HandCash',
    icon: '🤝',
    description: 'OAuth connect',
    tag: 'Requires App ID',
    tagColor: 'bg-yellow-500/20 text-yellow-400',
    available: true, // server will reject if not configured
  },
  {
    id: 'import' as Provider,
    name: 'Import Private Key',
    icon: '🔑',
    description: 'Advanced users',
    tag: null,
    tagColor: '',
    available: true,
  },
]

export function ConnectWalletModal({ open, onClose, onConnect, loading }: ConnectWalletModalProps) {
  const [importKey, setImportKey] = useState('')
  const [showImport, setShowImport] = useState(false)

  if (!open) return null

  const handleProviderClick = async (provider: Provider) => {
    if (provider === 'import') {
      setShowImport(true)
      return
    }
    await onConnect(provider)
  }

  const handleImportSubmit = async () => {
    if (!importKey.trim()) return
    await onConnect('import', { privateKey: importKey.trim() })
    setImportKey('')
    setShowImport(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-bold">Connect Wallet</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="px-6 text-sm text-gray-400 mb-4">
          Choose how you want to connect to AgentPay
        </p>

        {/* Provider List */}
        {!showImport ? (
          <div className="px-6 pb-6 space-y-2">
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderClick(p.id)}
                disabled={loading}
                className={`
                  w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-150
                  ${loading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[var(--bg)] hover:border-blue-500/50 cursor-pointer'}
                  border-[var(--border)] bg-transparent
                `}
              >
                <span className="text-3xl w-10 text-center">{p.icon}</span>
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {p.tag && (
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${p.tagColor}`}>
                        {p.tag}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">{p.description}</span>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}

            {/* Footer info */}
            <div className="pt-3 text-center">
              <p className="text-xs text-gray-500">
                🔒 Your keys never leave your device. AgentPay is non-custodial.
              </p>
            </div>
          </div>
        ) : (
          /* Import Private Key View */
          <div className="px-6 pb-6">
            <button
              onClick={() => setShowImport(false)}
              className="flex items-center gap-1 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
            >
              ← Back
            </button>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Private Key (WIF format)
                </label>
                <input
                  type="password"
                  value={importKey}
                  onChange={(e) => setImportKey(e.target.value)}
                  placeholder="Enter your BSV private key..."
                  className="input w-full"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-2">
                  ⚠️ Never share your private key. We don't store it — it's used to derive your address only.
                </p>
              </div>
              <button
                onClick={handleImportSubmit}
                disabled={loading || !importKey.trim()}
                className="btn btn-primary w-full"
              >
                {loading ? 'Importing...' : 'Import Wallet'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
