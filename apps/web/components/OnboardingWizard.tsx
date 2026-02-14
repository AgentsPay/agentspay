'use client'

import { useState } from 'react'
import { CopyButton } from './CopyButton'

type UserType = 'human' | 'agent'
type WalletChoice = 'yours' | 'handcash' | 'create' | 'import' | null
type Step = 'who' | 'wallet' | 'agent-setup' | 'credentials' | 'done'

interface OnboardingWizardProps {
  open: boolean
  onClose: () => void
  onConnect: (provider: string, data?: { privateKey?: string }) => Promise<void>
  loading: boolean
  credentials?: { apiKey?: string; privateKey?: string; walletId?: string; address?: string } | null
}

export function OnboardingWizard({ open, onClose, onConnect, loading, credentials }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('who')
  const [userType, setUserType] = useState<UserType | null>(null)
  const [walletChoice, setWalletChoice] = useState<WalletChoice>(null)
  const [importKey, setImportKey] = useState('')
  const [agentName, setAgentName] = useState('')
  const [savedCreds, setSavedCreds] = useState(false)

  if (!open) return null

  const reset = () => {
    setStep('who')
    setUserType(null)
    setWalletChoice(null)
    setImportKey('')
    setAgentName('')
    setSavedCreds(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // Step indicators
  const steps: { id: Step; label: string }[] = userType === 'agent'
    ? [{ id: 'who', label: 'Role' }, { id: 'wallet', label: 'Wallet' }, { id: 'agent-setup', label: 'Agent' }, { id: 'credentials', label: 'Keys' }, { id: 'done', label: 'Done' }]
    : [{ id: 'who', label: 'Role' }, { id: 'wallet', label: 'Wallet' }, { id: 'credentials', label: 'Keys' }, { id: 'done', label: 'Done' }]

  const currentIdx = steps.findIndex(s => s.id === step)

  const handleWalletConnect = async (choice: WalletChoice) => {
    setWalletChoice(choice)
    try {
      if (choice === 'create') {
        await onConnect('internal')
        if (userType === 'agent') {
          setStep('agent-setup')
        } else {
          setStep('credentials')
        }
      } else if (choice === 'yours') {
        await onConnect('yours')
        setStep(userType === 'agent' ? 'agent-setup' : 'done')
      } else if (choice === 'handcash') {
        await onConnect('handcash')
        // HandCash redirects, so we won't reach here
      } else if (choice === 'import') {
        // Show import input (handled in render)
      }
    } catch {
      // Error handled by parent toast — reset wallet choice so user can retry
      setWalletChoice(null)
    }
  }

  const handleImportSubmit = async () => {
    if (!importKey.trim()) return
    try {
      await onConnect('import', { privateKey: importKey.trim() })
      setStep(userType === 'agent' ? 'agent-setup' : 'done')
    } catch {
      // Error handled by parent toast
    }
  }

  const generateAgentConfig = () => {
    if (!credentials) return ''
    return `# AgentPay Configuration
# Generated for: ${agentName || 'My Agent'}
# Save this in your agent's .env file

AGENTPAY_API_URL=http://localhost:3100
AGENTPAY_WALLET_ID=${credentials.walletId || ''}
AGENTPAY_API_KEY=${credentials.apiKey || ''}
AGENTPAY_ADDRESS=${credentials.address || ''}
${credentials.privateKey ? `AGENTPAY_PRIVATE_KEY=${credentials.privateKey}` : '# Private key: connect via Yours Wallet'}
`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-lg mx-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-bold">
            {step === 'who' && 'Get Started'}
            {step === 'wallet' && 'Connect Wallet'}
            {step === 'agent-setup' && 'Agent Setup'}
            {step === 'credentials' && 'Save Your Keys'}
            {step === 'done' && '🎉 Ready!'}
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-3">
          <div className="flex items-center gap-1">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= currentIdx ? 'bg-blue-500' : 'bg-[var(--border)]'
                }`} />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {steps.map((s, i) => (
              <span key={s.id} className={`text-[10px] ${i <= currentIdx ? 'text-blue-400' : 'text-gray-600'}`}>
                {s.label}
              </span>
            ))}
          </div>
        </div>

        <div className="px-6 pb-6">
          {/* STEP 1: Who are you */}
          {step === 'who' && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400 mb-4">How will you use AgentPay?</p>
              
              <button
                onClick={() => { setUserType('human'); setStep('wallet') }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-blue-500/50 transition-all"
              >
                <span className="text-3xl">👤</span>
                <div className="text-left flex-1">
                  <div className="font-semibold">I'm a Human</div>
                  <div className="text-xs text-gray-500">I want to browse & pay for agent services manually</div>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <button
                onClick={() => { setUserType('agent'); setStep('wallet') }}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-blue-500/50 transition-all"
              >
                <span className="text-3xl">🤖</span>
                <div className="text-left flex-1">
                  <div className="font-semibold">I'm connecting an AI Agent</div>
                  <div className="text-xs text-gray-500">My agent needs to pay/receive for services programmatically</div>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}

          {/* STEP 2: Wallet */}
          {step === 'wallet' && walletChoice !== 'import' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-400 mb-4">
                {userType === 'agent'
                  ? 'How should your agent handle payments?'
                  : 'Choose how to connect your wallet'}
              </p>

              {userType === 'agent' && (
                <button
                  onClick={() => handleWalletConnect('create')}
                  disabled={loading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-blue-500/30 bg-blue-500/5 hover:border-blue-500/50 transition-all"
                >
                  <span className="text-3xl">⚡</span>
                  <div className="text-left flex-1">
                    <div className="font-semibold">Auto-create wallet for agent</div>
                    <div className="text-xs text-gray-500">Generate keys → save to agent's .env → done</div>
                  </div>
                  <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Recommended</span>
                </button>
              )}

              <button
                onClick={() => handleWalletConnect('yours')}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-blue-500/50 transition-all"
              >
                <span className="text-3xl">👛</span>
                <div className="text-left flex-1">
                  <div className="font-semibold">Yours Wallet</div>
                  <div className="text-xs text-gray-500">
                    {userType === 'agent'
                      ? 'Agent uses your Yours Wallet (you approve txns)'
                      : 'Connect browser extension'}
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleWalletConnect('handcash')}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-blue-500/50 transition-all"
              >
                <span className="text-3xl">🤝</span>
                <div className="text-left flex-1">
                  <div className="font-semibold">HandCash</div>
                  <div className="text-xs text-gray-500">OAuth connect</div>
                </div>
                <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">Requires App ID</span>
              </button>

              {userType !== 'agent' && (
                <button
                  onClick={() => handleWalletConnect('create')}
                  disabled={loading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-blue-500/50 transition-all"
                >
                  <span className="text-3xl">⚡</span>
                  <div className="text-left flex-1">
                    <div className="font-semibold">Create New Wallet</div>
                    <div className="text-xs text-gray-500">Generate keys instantly</div>
                  </div>
                </button>
              )}

              <button
                onClick={() => setWalletChoice('import')}
                disabled={loading}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-[var(--border)] hover:border-blue-500/50 transition-all"
              >
                <span className="text-3xl">🔑</span>
                <div className="text-left flex-1">
                  <div className="font-semibold">Import Private Key</div>
                  <div className="text-xs text-gray-500">Advanced — paste your WIF key</div>
                </div>
              </button>

              <button onClick={() => { setStep('who'); setUserType(null) }} className="text-sm text-gray-500 hover:text-white mt-2">
                ← Back
              </button>
            </div>
          )}

          {/* Import Key sub-step */}
          {step === 'wallet' && walletChoice === 'import' && (
            <div>
              <button onClick={() => setWalletChoice(null)} className="text-sm text-gray-400 hover:text-white mb-4">← Back</button>
              <label className="block text-sm font-medium text-gray-400 mb-2">Private Key (WIF)</label>
              <input
                type="password"
                value={importKey}
                onChange={e => setImportKey(e.target.value)}
                placeholder="Enter your BSV private key..."
                className="input w-full mb-3"
                autoFocus
              />
              <button onClick={handleImportSubmit} disabled={loading || !importKey.trim()} className="btn btn-primary w-full">
                {loading ? 'Importing...' : 'Import & Continue'}
              </button>
            </div>
          )}

          {/* STEP 3: Agent Setup (agent flow only) */}
          {step === 'agent-setup' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Configure your agent's identity on the network.</p>
              
              <div>
                <label className="label">Agent Name</label>
                <input
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  placeholder="e.g., SecurityScanner-v1"
                  className="input w-full"
                />
              </div>

              {/* Auto-generated .env config */}
              {credentials && (
                <div>
                  <label className="label">Agent Configuration File</label>
                  <div className="relative">
                    <pre className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre">
                      {generateAgentConfig()}
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton text={generateAgentConfig()} label="Copy .env" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Save this as <code className="text-blue-400">.env</code> in your agent's project directory
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={() => setStep('credentials')} className="btn btn-primary flex-1">
                  View Full Credentials →
                </button>
                <button onClick={() => { setSavedCreds(true); setStep('done') }} className="btn btn-secondary">
                  Skip, I copied the .env
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: Credentials */}
          {step === 'credentials' && credentials && (
            <div className="space-y-3">
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span>⚠️</span>
                  <span className="font-semibold text-yellow-500 text-sm">Save these now — shown only once!</span>
                </div>
              </div>

              {credentials.walletId && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Wallet ID</div>
                  <div className="font-mono text-xs break-all">{credentials.walletId}</div>
                  <CopyButton text={credentials.walletId} label="Copy" />
                </div>
              )}

              {credentials.address && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">BSV Address</div>
                  <div className="font-mono text-xs break-all">{credentials.address}</div>
                  <CopyButton text={credentials.address} label="Copy" />
                </div>
              )}

              {credentials.apiKey && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">API Key</div>
                  <div className="font-mono text-xs break-all">{credentials.apiKey}</div>
                  <CopyButton text={credentials.apiKey} label="Copy" />
                </div>
              )}

              {credentials.privateKey && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Private Key (WIF)</div>
                  <div className="font-mono text-xs break-all">{credentials.privateKey}</div>
                  <CopyButton text={credentials.privateKey} label="Copy" />
                </div>
              )}

              <button onClick={() => setStep('done')} className="btn btn-primary w-full">
                ✓ I've saved everything
              </button>
            </div>
          )}

          {/* STEP 5: Done */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">🚀</div>
              <h3 className="text-xl font-bold mb-2">
                {userType === 'agent' ? 'Agent Connected!' : 'Wallet Connected!'}
              </h3>
              <p className="text-sm text-gray-400 mb-6">
                {userType === 'agent'
                  ? 'Your agent is ready to discover, pay, and provide services on the marketplace.'
                  : 'You can now browse services, execute them, and manage your payments.'}
              </p>

              {userType === 'agent' && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 mb-4 text-left">
                  <div className="text-xs text-gray-500 mb-2">Quick test — paste in your agent:</div>
                  <pre className="text-xs font-mono text-gray-300 overflow-x-auto">{`import { AgentsPay } from 'agentspay'

const ap = new AgentsPay()
const services = await ap.search({ category: 'ai' })
console.log('Available:', services.length)`}</pre>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={handleClose} className="btn btn-primary flex-1">
                  {userType === 'agent' ? 'Go to Dashboard' : 'Browse Marketplace'}
                </button>
              </div>
            </div>
          )}

          {/* Footer */}
          {step !== 'done' && (
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-500">🔒 Save your private key — it's shown only once and not stored on server</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
