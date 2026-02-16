'use client'

import { useState } from 'react'
import { CopyButton } from './CopyButton'

type Step = 'setup' | 'credentials' | 'done'

interface OnboardingWizardProps {
  open: boolean
  onClose: () => void
  onConnect: (provider: string, data?: { privateKey?: string; agentName?: string; capabilities?: string[] }) => Promise<void>
  loading: boolean
  credentials?: { apiKey?: string; privateKey?: string; walletId?: string; address?: string } | null
}

export function OnboardingWizard({ open, onClose, onConnect, loading, credentials }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('setup')
  const [importKey, setImportKey] = useState('')
  const [agentName, setAgentName] = useState('')
  const [showImport, setShowImport] = useState(false)

  if (!open) return null

  const reset = () => {
    setStep('setup')
    setImportKey('')
    setAgentName('')
    setShowImport(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const steps: { id: Step; label: string }[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'credentials', label: 'Keys' },
    { id: 'done', label: 'Done' },
  ]

  const currentIdx = steps.findIndex(s => s.id === step)

  const handleProvision = async () => {
    try {
      await onConnect('provision', { agentName: agentName || 'My Agent' })
      setStep('credentials')
    } catch {
      // Error handled by parent toast
    }
  }

  const handleImportSubmit = async () => {
    if (!importKey.trim()) return
    try {
      await onConnect('import', { privateKey: importKey.trim() })
      // Auto-register identity for the imported wallet
      try {
        await onConnect('register-identity', { agentName: agentName || 'My Agent' })
      } catch {
        // Identity registration is optional — wallet still works
      }
      setStep('credentials')
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
${credentials.privateKey ? `AGENTPAY_PRIVATE_KEY=${credentials.privateKey}` : '# Private key: not available (imported wallet)'}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-lg mx-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-bold">
            {step === 'setup' && 'Set Up Your Agent'}
            {step === 'credentials' && 'Save Your Keys'}
            {step === 'done' && 'Ready!'}
          </h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
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
          {/* STEP 1: Setup */}
          {step === 'setup' && !showImport && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                AgentPay creates a wallet for your agent. Fund it externally — your main keys stay safe.
              </p>

              <div>
                <label className="label">Agent Name</label>
                <input
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  placeholder="e.g., SecurityScanner-v1"
                  className="input w-full"
                  autoFocus
                />
              </div>

              <button
                onClick={handleProvision}
                disabled={loading}
                className="btn btn-primary w-full"
              >
                {loading ? 'Creating...' : 'Create Agent'}
              </button>

              <button
                onClick={() => setShowImport(true)}
                className="text-sm text-gray-500 hover:text-blue-400 transition-colors w-full text-center"
              >
                Import Private Key (advanced)
              </button>
            </div>
          )}

          {/* Import Key sub-view */}
          {step === 'setup' && showImport && (
            <div className="space-y-4">
              <button onClick={() => setShowImport(false)} className="text-sm text-gray-400 hover:text-white">&larr; Back</button>

              <div>
                <label className="label">Agent Name</label>
                <input
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  placeholder="e.g., SecurityScanner-v1"
                  className="input w-full"
                />
              </div>

              <div>
                <label className="label">Private Key (WIF)</label>
                <input
                  type="password"
                  value={importKey}
                  onChange={e => setImportKey(e.target.value)}
                  placeholder="Enter your BSV private key..."
                  className="input w-full"
                  autoFocus
                />
              </div>

              <button
                onClick={handleImportSubmit}
                disabled={loading || !importKey.trim()}
                className="btn btn-primary w-full"
              >
                {loading ? 'Importing...' : 'Import & Register'}
              </button>
            </div>
          )}

          {/* STEP 2: Credentials */}
          {step === 'credentials' && credentials && (
            <div className="space-y-3">
              <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-yellow-500 text-sm">Save these now — shown only once!</span>
                </div>
              </div>

              {/* .env config block */}
              {((credentials as any).envConfig || true) && (
                <div>
                  <label className="label">.env Configuration</label>
                  <div className="relative">
                    <pre className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre max-h-48 overflow-y-auto">
                      {(credentials as any).envConfig || generateAgentConfig()}
                    </pre>
                    <div className="absolute top-2 right-2">
                      <CopyButton text={(credentials as any).envConfig || generateAgentConfig()} label="Copy .env" />
                    </div>
                  </div>
                </div>
              )}

              {credentials.address && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Deposit Address</div>
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

              {credentials.walletId && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Wallet ID</div>
                  <div className="font-mono text-xs break-all">{credentials.walletId}</div>
                  <CopyButton text={credentials.walletId} label="Copy" />
                </div>
              )}

              <button onClick={() => setStep('done')} className="btn btn-primary w-full">
                I've saved everything &rarr;
              </button>
            </div>
          )}

          {/* STEP 3: Done */}
          {step === 'done' && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">🚀</div>
              <h3 className="text-xl font-bold mb-2">Agent Connected!</h3>
              <p className="text-sm text-gray-400 mb-4">
                Fund your wallet to start transacting.
              </p>

              {credentials?.address && (
                <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4 mb-4 text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-semibold text-green-400 text-sm">Send BSV or MNEE to get started</span>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">
                    Send any amount to this address. Even $10 is enough for hundreds of transactions.
                  </p>
                  <div className="flex items-center gap-2 bg-[var(--bg)] rounded p-2">
                    <code className="text-xs text-green-500 font-mono break-all flex-1">{credentials.address}</code>
                    <CopyButton text={credentials.address} label="Copy" />
                  </div>
                </div>
              )}

              <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 mb-4 text-left">
                <div className="text-xs text-gray-500 mb-2">Quick start — paste in your agent:</div>
                <pre className="text-xs font-mono text-gray-300 overflow-x-auto">{`import { AgentPay } from 'agentspay'

const ap = new AgentPay({
  apiUrl: process.env.AGENTPAY_API_URL,
  walletId: process.env.AGENTPAY_WALLET_ID,
  apiKey: process.env.AGENTPAY_API_KEY,
})
const services = await ap.search({ category: 'ai' })
console.log('Available:', services.length)`}</pre>
              </div>

              <button onClick={handleClose} className="btn btn-primary w-full">
                Go to Dashboard
              </button>
            </div>
          )}

          {/* Footer */}
          {step !== 'done' && (
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-500">Your private key is shown once on creation — save it securely</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
