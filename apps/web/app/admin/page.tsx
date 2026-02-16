'use client'

import { useEffect, useMemo, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3100'
const STORAGE_KEY = 'agentpay_admin_console_v1'

type RotationResult = {
  ok: boolean
  activeAuth: {
    keyVersion: string | null
    wallet2faRequired: boolean
    walletAddress: string | null
  }
  rotation: {
    currentConfigured: boolean
    previousConfigured: boolean
    legacyConfigured: boolean
    totalAcceptedKeys: number
  }
  recommendations: string[]
}

type AdminMetrics = {
  timestamp: string
  disputes: { open: number; resolved24h: number }
  payments: { byStatus: Record<string, number> }
  security: { adminAuthDenied1h: number; settlementFailures24h: number; walletSessionsActive: number }
  x402: { consumedPayments: number }
}

type Dispute = {
  id: string
  paymentId: string
  status: string
  resolution?: string
  reason: string
  createdAt: string
}

type AuditLog = {
  id: number
  action: string
  status: string
  adminKeyVersion?: string
  disputeId?: string
  ip?: string
  userAgent?: string
  details?: string
  createdAt: string
}

type MultisigSigningPayload = {
  action: 'release' | 'refund'
  paymentId: string
  digestHex: string
  preimageHex: string
  txHex: string
  sighashType: number
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('')
  const [walletToken, setWalletToken] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [challengeAddress, setChallengeAddress] = useState('')
  const [challengeNonce, setChallengeNonce] = useState('')
  const [challengeText, setChallengeText] = useState('')
  const [challengeExpires, setChallengeExpires] = useState('')
  const [walletSignature, setWalletSignature] = useState('')
  const [statusFilter, setStatusFilter] = useState('open')
  const [resolveMode, setResolveMode] = useState<'refund' | 'release'>('refund')
  const [settlementPaymentId, setSettlementPaymentId] = useState('')
  const [settlementMessage, setSettlementMessage] = useState('')
  const [settlementSignature, setSettlementSignature] = useState('')
  const [adminTxSignatureHex, setAdminTxSignatureHex] = useState('')
  const [multisigPayload, setMultisigPayload] = useState<MultisigSigningPayload | null>(null)
  const [adminMultisigPublicKey, setAdminMultisigPublicKey] = useState('')
  const [auditStatus, setAuditStatus] = useState('')
  const [auditAction, setAuditAction] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [rotation, setRotation] = useState<RotationResult | null>(null)
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditTotal, setAuditTotal] = useState(0)

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      setAdminKey(parsed.adminKey || '')
      setWalletToken(parsed.walletToken || '')
      setWalletAddress(parsed.walletAddress || '')
      setChallengeAddress(parsed.challengeAddress || '')
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ adminKey, walletToken, walletAddress, challengeAddress })
    )
  }, [adminKey, walletToken, walletAddress, challengeAddress])

  const hasCredentials = useMemo(() => adminKey.trim().length > 0, [adminKey])

  async function requestAdmin(path: string, method = 'GET', body?: unknown) {
    if (!adminKey.trim()) throw new Error('Set X-Admin-Key first')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Admin-Key': adminKey.trim(),
    }
    if (walletToken.trim()) headers['X-Admin-Wallet-Token'] = walletToken.trim()

    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    return data
  }

  async function refreshAll() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const [rotationData, metricsData, disputesData, auditData] = await Promise.all([
        requestAdmin('/api/admin/key-rotation/validate'),
        requestAdmin('/api/admin/metrics'),
        requestAdmin(`/api/admin/disputes?status=${encodeURIComponent(statusFilter)}`),
        requestAdmin('/api/admin/audit-logs?limit=50'),
      ])
      setRotation(rotationData)
      setMetrics(metricsData.metrics)
      setDisputes(disputesData.disputes || [])
      setAuditLogs(auditData.logs || [])
      setAuditTotal(auditData.total || 0)
      setNotice('Admin data updated')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function requestChallenge() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const data = await requestAdmin('/api/admin/auth/challenge', 'POST', {
        address: challengeAddress || undefined,
      })
      setChallengeNonce(data.nonce)
      setChallengeText(data.challenge)
      setChallengeExpires(data.expiresAt)
      setNotice('Challenge created. Sign the challenge string with your admin wallet.')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyChallenge() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const address = walletAddress || challengeAddress
      if (!address) throw new Error('Set wallet address')
      if (!challengeNonce) throw new Error('Request a challenge first')
      if (!walletSignature) throw new Error('Paste wallet signature first')

      const data = await requestAdmin('/api/admin/auth/verify', 'POST', {
        nonce: challengeNonce,
        address,
        signature: walletSignature,
      })
      setWalletToken(data.token || '')
      setWalletAddress(data.walletAddress || address)
      setNotice(`Wallet session active until ${data.expiresAt}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function revokeWalletToken() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      await requestAdmin('/api/admin/auth/revoke', 'POST')
      setWalletToken('')
      setNotice('Wallet token revoked')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadSettlementMessage(paymentId: string) {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const data = await requestAdmin(
        `/api/admin/payments/${encodeURIComponent(paymentId)}/settlement-message?action=${resolveMode}`
      )
      setSettlementPaymentId(paymentId)
      setSettlementMessage(data.message || '')
      setMultisigPayload(data.multisigSigningPayload || null)
      setAdminMultisigPublicKey(data.adminMultisigPublicKey || '')
      setNotice(`Settlement message loaded for payment ${paymentId}. Sign it with your admin wallet.`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadDisputeResolvePayload(disputeId: string, action: 'refund' | 'release') {
    const data = await requestAdmin(
      `/api/admin/disputes/${encodeURIComponent(disputeId)}/resolve-payload?action=${action}`
    )
    setSettlementPaymentId(data.paymentId || '')
    setSettlementMessage(data.settlementMessage || '')
    setMultisigPayload(data.multisigSigningPayload || null)
    setAdminMultisigPublicKey(data.adminMultisigPublicKey || '')
    return data
  }

  async function resolveDispute(disputeId: string, paymentId: string) {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (settlementPaymentId !== paymentId || !settlementMessage) {
        throw new Error('Load settlement message for this payment before resolving')
      }
      if (!settlementSignature.trim()) {
        throw new Error('Paste settlement signature before resolving')
      }
      await requestAdmin(`/api/admin/disputes/${encodeURIComponent(disputeId)}/resolve`, 'POST', {
        resolution: resolveMode,
        adminSignature: settlementSignature.trim(),
        adminTxSignatureHex: adminTxSignatureHex.trim() || undefined,
      })
      setNotice(`Dispute ${disputeId} resolved with ${resolveMode}`)
      setSettlementSignature('')
      setAdminTxSignatureHex('')
      setSettlementMessage('')
      setMultisigPayload(null)
      setSettlementPaymentId('')
      await refreshAll()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function quickResolveDispute(disputeId: string) {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const payloadData = await loadDisputeResolvePayload(disputeId, resolveMode)

      if (!settlementSignature.trim()) {
        throw new Error('Paste admin settlement signature before quick resolve')
      }
      if (payloadData?.multisigSigningPayload && !adminTxSignatureHex.trim()) {
        throw new Error('Paste admin tx signature before quick resolve')
      }

      await requestAdmin(`/api/admin/disputes/${encodeURIComponent(disputeId)}/resolve`, 'POST', {
        resolution: resolveMode,
        adminSignature: settlementSignature.trim(),
        adminTxSignatureHex: adminTxSignatureHex.trim() || undefined,
      })
      setNotice(`Dispute ${disputeId} quick-resolved with ${resolveMode}`)
      setSettlementSignature('')
      setAdminTxSignatureHex('')
      setSettlementMessage('')
      setMultisigPayload(null)
      setSettlementPaymentId('')
      await refreshAll()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function normalizeAdminTxSignature() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (!adminTxSignatureHex.trim()) throw new Error('Paste a tx signature first')
      if (!multisigPayload) throw new Error('Load a multisig settlement message first')
      const data = await requestAdmin('/api/admin/multisig/normalize-signature', 'POST', {
        signature: adminTxSignatureHex.trim(),
        sighashType: multisigPayload.sighashType,
        digestHex: multisigPayload.digestHex,
        publicKeyHex: adminMultisigPublicKey || undefined,
      })
      setAdminTxSignatureHex(data.checksigHex || '')
      setNotice(`Tx signature normalized (${data.detectedFormat})`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadAuditLogs() {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (auditAction) params.set('action', auditAction)
      if (auditStatus) params.set('status', auditStatus)
      params.set('limit', '100')
      const data = await requestAdmin(`/api/admin/audit-logs?${params.toString()}`)
      setAuditLogs(data.logs || [])
      setAuditTotal(data.total || 0)
      setNotice('Audit logs updated')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen py-12 px-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Admin Console</h1>
          <p className="text-gray-400">Dispute ops, security checks, metrics, and audit logs.</p>
        </div>

        <div className="card border-yellow-500/30 bg-yellow-500/5">
          <p className="text-sm text-yellow-200">
            Sensitive mode: this page stores admin credentials in <code>sessionStorage</code> only. Close the browser to clear.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Admin Credentials</h2>
            <div className="space-y-3">
              <div>
                <label className="label">X-Admin-Key</label>
                <input className="input" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} />
              </div>
              <div>
                <label className="label">X-Admin-Wallet-Token (optional / required if 2FA enabled)</label>
                <input className="input" value={walletToken} onChange={(e) => setWalletToken(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-primary text-sm" disabled={!hasCredentials || loading} onClick={refreshAll}>
                  {loading ? 'Loading...' : 'Validate & Refresh'}
                </button>
                <button className="btn btn-secondary text-sm" disabled={loading || !walletToken} onClick={revokeWalletToken}>
                  Revoke Wallet Token
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Wallet Step-Up (Yours)</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Admin Wallet Address</label>
                <input className="input" value={walletAddress} onChange={(e) => setWalletAddress(e.target.value)} placeholder="1... or m/n..." />
              </div>
              <div>
                <label className="label">Request Challenge For Address (optional)</label>
                <input className="input" value={challengeAddress} onChange={(e) => setChallengeAddress(e.target.value)} placeholder="same as above or leave empty" />
              </div>
              <div className="flex gap-2">
                <button className="btn btn-secondary text-sm" disabled={!hasCredentials || loading} onClick={requestChallenge}>
                  Get Challenge
                </button>
              </div>
              {challengeNonce && (
                <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-1">Nonce: {challengeNonce}</div>
                  <div className="text-xs text-gray-500 mb-2">Expires: {challengeExpires}</div>
                  <pre className="text-xs whitespace-pre-wrap break-words">{challengeText}</pre>
                </div>
              )}
              <div>
                <label className="label">Wallet Signature (base64 compact)</label>
                <textarea
                  className="input min-h-20"
                  value={walletSignature}
                  onChange={(e) => setWalletSignature(e.target.value)}
                  placeholder="Paste signature from wallet"
                />
              </div>
              <button className="btn btn-primary text-sm" disabled={!hasCredentials || loading} onClick={verifyChallenge}>
                Verify Wallet Signature
              </button>
            </div>
          </div>
        </div>

        {error && <div className="card border-red-500/30 bg-red-500/5 text-red-300 text-sm">{error}</div>}
        {notice && <div className="card border-green-500/30 bg-green-500/5 text-green-300 text-sm">{notice}</div>}

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Rotation & Auth State</h2>
            {rotation ? (
              <div className="space-y-2 text-sm">
                <div>Active key version: <span className="text-blue-400">{rotation.activeAuth.keyVersion || 'n/a'}</span></div>
                <div>Wallet 2FA required: <span className="text-blue-400">{String(rotation.activeAuth.wallet2faRequired)}</span></div>
                <div>Wallet session address: <span className="text-blue-400">{rotation.activeAuth.walletAddress || 'none'}</span></div>
                <div>Accepted admin keys: <span className="text-blue-400">{rotation.rotation.totalAcceptedKeys}</span></div>
                <div className="pt-2 text-xs text-gray-400">
                  Current: {String(rotation.rotation.currentConfigured)} | Previous: {String(rotation.rotation.previousConfigured)} | Legacy: {String(rotation.rotation.legacyConfigured)}
                </div>
                {rotation.recommendations.length > 0 && (
                  <ul className="text-xs text-yellow-300 list-disc pl-5 space-y-1">
                    {rotation.recommendations.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Run "Validate & Refresh" to load.</p>
            )}
          </div>

          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Metrics</h2>
            {metrics ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-[var(--bg)] rounded p-3">
                  <div className="text-xs text-gray-500">Open disputes</div>
                  <div className="text-2xl font-bold">{metrics.disputes.open}</div>
                </div>
                <div className="bg-[var(--bg)] rounded p-3">
                  <div className="text-xs text-gray-500">Resolved (24h)</div>
                  <div className="text-2xl font-bold">{metrics.disputes.resolved24h}</div>
                </div>
                <div className="bg-[var(--bg)] rounded p-3">
                  <div className="text-xs text-gray-500">Admin auth denied (1h)</div>
                  <div className="text-2xl font-bold">{metrics.security.adminAuthDenied1h}</div>
                </div>
                <div className="bg-[var(--bg)] rounded p-3">
                  <div className="text-xs text-gray-500">Settlement errors (24h)</div>
                  <div className="text-2xl font-bold">{metrics.security.settlementFailures24h}</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Run "Validate & Refresh" to load.</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-center gap-2 justify-between mb-4">
            <h2 className="text-xl font-semibold">Disputes</h2>
            <div className="flex gap-2">
              <select className="input !w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="open">open</option>
                <option value="under_review">under_review</option>
                <option value="resolved_refund">resolved_refund</option>
                <option value="resolved_release">resolved_release</option>
              </select>
              <button className="btn btn-secondary text-sm" disabled={!hasCredentials || loading} onClick={refreshAll}>
                Reload
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-sm text-gray-400">Resolution mode</label>
            <select className="input !w-auto" value={resolveMode} onChange={(e) => setResolveMode(e.target.value as 'refund' | 'release')}>
              <option value="refund">refund</option>
              <option value="release">release</option>
            </select>
          </div>
          <div className="space-y-2 mb-4">
            <div className="text-xs text-gray-500">Settlement payment: {settlementPaymentId || 'none selected'}</div>
            {settlementMessage && (
              <pre className="text-xs whitespace-pre-wrap break-words bg-[var(--bg)] border border-[var(--border)] rounded p-3">{settlementMessage}</pre>
            )}
            {multisigPayload && (
              <div className="bg-[var(--bg)] border border-[var(--border)] rounded p-3 space-y-2">
                <div className="text-xs text-gray-500">Multisig tx signing required (external admin signer)</div>
                <div className="text-xs break-all"><strong>digest:</strong> {multisigPayload.digestHex}</div>
                <div className="text-xs break-all"><strong>sighash:</strong> {multisigPayload.sighashType}</div>
                <div className="text-xs break-all"><strong>admin pubkey:</strong> {adminMultisigPublicKey || 'not configured'}</div>
                <details>
                  <summary className="text-xs cursor-pointer">Show preimage / tx hex</summary>
                  <div className="text-xs break-all mt-2"><strong>preimage:</strong> {multisigPayload.preimageHex}</div>
                  <div className="text-xs break-all mt-2"><strong>txHex:</strong> {multisigPayload.txHex}</div>
                </details>
              </div>
            )}
            <textarea
              className="input min-h-20"
              value={settlementSignature}
              onChange={(e) => setSettlementSignature(e.target.value)}
              placeholder="Paste admin settlement signature (base64 compact)"
            />
            <textarea
              className="input min-h-20"
              value={adminTxSignatureHex}
              onChange={(e) => setAdminTxSignatureHex(e.target.value)}
              placeholder="If multisig shown above: paste admin tx signature in checksig hex format"
            />
            <button className="btn btn-secondary text-xs self-start" disabled={loading || !multisigPayload} onClick={normalizeAdminTxSignature}>
              Normalize Tx Signature
            </button>
          </div>
          <div className="space-y-2">
            {disputes.length === 0 && <p className="text-sm text-gray-400">No disputes for this filter.</p>}
            {disputes.map((d) => (
              <div key={d.id} className="bg-[var(--bg)] border border-[var(--border)] rounded p-3 flex flex-wrap items-center gap-3 justify-between">
                <div className="min-w-80 flex-1">
                  <div className="text-sm font-semibold">{d.id}</div>
                  <div className="text-xs text-gray-500">payment: {d.paymentId} • status: {d.status}</div>
                  <div className="text-xs text-gray-300 mt-1">{d.reason}</div>
                </div>
                {(d.status === 'open' || d.status === 'under_review') && (
                  <div className="flex gap-2">
                    <button className="btn btn-secondary text-xs" disabled={loading} onClick={() => loadDisputeResolvePayload(d.id, resolveMode)}>
                      Load Message
                    </button>
                    <button className="btn btn-primary text-xs" disabled={loading} onClick={() => resolveDispute(d.id, d.paymentId)}>
                      Resolve ({resolveMode})
                    </button>
                    <button className="btn btn-primary text-xs" disabled={loading} onClick={() => quickResolveDispute(d.id)}>
                      Quick Resolve
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-xl font-semibold">Audit Logs</h2>
            <div className="text-xs text-gray-500">Total: {auditTotal}</div>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            <input className="input !w-64" placeholder="action filter (exact)" value={auditAction} onChange={(e) => setAuditAction(e.target.value)} />
            <select className="input !w-48" value={auditStatus} onChange={(e) => setAuditStatus(e.target.value)}>
              <option value="">all statuses</option>
              <option value="success">success</option>
              <option value="denied">denied</option>
              <option value="error">error</option>
            </select>
            <button className="btn btn-secondary text-sm" disabled={!hasCredentials || loading} onClick={loadAuditLogs}>
              Apply Filters
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-[var(--border)]">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Key Ver.</th>
                  <th className="py-2 pr-3">Dispute</th>
                  <th className="py-2 pr-3">IP</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-[var(--border)]/50">
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3">{log.action}</td>
                    <td className="py-2 pr-3">{log.status}</td>
                    <td className="py-2 pr-3">{log.adminKeyVersion || '-'}</td>
                    <td className="py-2 pr-3">{log.disputeId || '-'}</td>
                    <td className="py-2 pr-3">{log.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  )
}
