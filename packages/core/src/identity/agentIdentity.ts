/**
 * Agent Identity On-Chain (BSV OP_RETURN)
 * 
 * Equivalent to ERC-8004 but on BSV — agent identity, reputation, 
 * and capabilities anchored immutably on-chain.
 * 
 * Structure:
 *   OP_RETURN <protocol> <version> <action> <data>
 * 
 * Protocol prefix: "agentpay.id"
 * 
 * Actions:
 *   - register: Register new agent identity
 *   - update:   Update agent metadata
 *   - attest:   Reputation attestation from another agent
 *   - revoke:   Revoke an identity
 */

import crypto from 'crypto'
import { getDb } from '../registry/db'
import { anchorReceiptHash } from '../bsv/opreturn'
import { config } from '../config'

export const PROTOCOL_PREFIX = 'agentpay.id'
export const PROTOCOL_VERSION = '1'

export interface AgentIdentity {
  id: string              // wallet ID
  address: string         // BSV address (public key derived)
  displayName: string     // Human-readable name
  type: 'human' | 'agent' | 'service'
  capabilities: string[]  // What this agent can do
  metadata: Record<string, any>
  reputation: {
    score: number         // 0-100
    totalTransactions: number
    successRate: number   // 0-1
    totalVolumeSats: number
    attestations: number  // on-chain attestation count
  }
  registeredAt: string
  lastUpdated: string
  onChainTxId: string | null  // OP_RETURN tx anchoring this identity
}

export interface IdentityAttestation {
  id: string
  fromAddress: string     // Attester
  toAddress: string       // Attestee
  score: number           // 1-5 stars
  comment: string
  txid: string            // On-chain proof
  createdAt: string
}

/**
 * Build identity hash for on-chain anchoring
 */
function buildIdentityHash(identity: Partial<AgentIdentity>): string {
  const payload = JSON.stringify({
    protocol: PROTOCOL_PREFIX,
    version: PROTOCOL_VERSION,
    action: 'register',
    address: identity.address,
    displayName: identity.displayName,
    type: identity.type,
    capabilities: identity.capabilities,
    timestamp: new Date().toISOString(),
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

/**
 * Build attestation hash for on-chain anchoring
 */
function buildAttestationHash(attestation: { from: string; to: string; score: number; comment: string }): string {
  const payload = JSON.stringify({
    protocol: PROTOCOL_PREFIX,
    version: PROTOCOL_VERSION,
    action: 'attest',
    ...attestation,
    timestamp: new Date().toISOString(),
  })
  return crypto.createHash('sha256').update(payload).digest('hex')
}

export class AgentIdentityManager {
  /**
   * Register a new agent identity and optionally anchor on-chain
   */
  async register(
    walletId: string,
    address: string,
    displayName: string,
    type: 'human' | 'agent' | 'service' = 'agent',
    capabilities: string[] = [],
    metadata: Record<string, any> = {},
    anchorOnChain: boolean = false,
    privateKeyWif?: string
  ): Promise<AgentIdentity> {
    const db = getDb()
    const now = new Date().toISOString()

    // Check if identity already exists for this address
    const existing = db.prepare('SELECT * FROM agent_identities WHERE address = ?').get(address) as any
    if (existing) {
      throw new Error(`Identity already registered for address ${address}`)
    }

    let onChainTxId: string | null = null

    // Anchor on-chain if requested
    if (anchorOnChain && privateKeyWif && !config.demoMode) {
      const identityHash = buildIdentityHash({ address, displayName, type, capabilities })
      const result = await anchorReceiptHash(identityHash, privateKeyWif, address)
      onChainTxId = result.txId
    } else if (anchorOnChain && config.demoMode) {
      onChainTxId = `demo-identity-${crypto.randomBytes(16).toString('hex')}`
    }

    db.prepare(`
      INSERT INTO agent_identities (id, address, displayName, type, capabilities, metadata, reputationScore, totalTransactions, successRate, totalVolumeSats, attestationCount, onChainTxId, registeredAt, lastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, 50, 0, 1.0, 0, 0, ?, ?, ?)
    `).run(
      walletId, address, displayName, type,
      JSON.stringify(capabilities), JSON.stringify(metadata),
      onChainTxId, now, now
    )

    return {
      id: walletId,
      address,
      displayName,
      type,
      capabilities,
      metadata,
      reputation: {
        score: 50,
        totalTransactions: 0,
        successRate: 1.0,
        totalVolumeSats: 0,
        attestations: 0,
      },
      registeredAt: now,
      lastUpdated: now,
      onChainTxId,
    }
  }

  /**
   * Get identity by address
   */
  getByAddress(address: string): AgentIdentity | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM agent_identities WHERE address = ?').get(address) as any
    if (!row) return null
    return this.rowToIdentity(row)
  }

  /**
   * Get identity by wallet ID
   */
  getById(id: string): AgentIdentity | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM agent_identities WHERE id = ?').get(id) as any
    if (!row) return null
    return this.rowToIdentity(row)
  }

  /**
   * Update identity metadata
   */
  update(id: string, updates: { displayName?: string; capabilities?: string[]; metadata?: Record<string, any> }): AgentIdentity | null {
    const db = getDb()
    const existing = this.getById(id)
    if (!existing) return null

    const now = new Date().toISOString()
    if (updates.displayName) {
      db.prepare('UPDATE agent_identities SET displayName = ?, lastUpdated = ? WHERE id = ?').run(updates.displayName, now, id)
    }
    if (updates.capabilities) {
      db.prepare('UPDATE agent_identities SET capabilities = ?, lastUpdated = ? WHERE id = ?').run(JSON.stringify(updates.capabilities), now, id)
    }
    if (updates.metadata) {
      db.prepare('UPDATE agent_identities SET metadata = ?, lastUpdated = ? WHERE id = ?').run(JSON.stringify(updates.metadata), now, id)
    }

    return this.getById(id)
  }

  /**
   * Update reputation after a transaction
   */
  updateReputation(id: string, transactionSuccess: boolean, volumeSats: number): void {
    const db = getDb()
    const identity = this.getById(id)
    if (!identity) return

    const newTotal = identity.reputation.totalTransactions + 1
    const successes = Math.round(identity.reputation.successRate * identity.reputation.totalTransactions) + (transactionSuccess ? 1 : 0)
    const newSuccessRate = successes / newTotal
    const newVolume = identity.reputation.totalVolumeSats + volumeSats

    // Score: weighted average of success rate (70%) + volume factor (30%)
    const volumeFactor = Math.min(newVolume / 1_000_000, 1) // Cap at 1M sats
    const newScore = Math.round(newSuccessRate * 70 + volumeFactor * 30)

    db.prepare(`
      UPDATE agent_identities 
      SET reputationScore = ?, totalTransactions = ?, successRate = ?, totalVolumeSats = ?, lastUpdated = ?
      WHERE id = ?
    `).run(newScore, newTotal, newSuccessRate, newVolume, new Date().toISOString(), id)
  }

  /**
   * Create an on-chain attestation from one agent to another
   */
  async attest(
    fromAddress: string,
    toAddress: string,
    score: number,
    comment: string,
    privateKeyWif?: string
  ): Promise<IdentityAttestation> {
    const db = getDb()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    let txid = ''

    if (privateKeyWif && !config.demoMode) {
      const hash = buildAttestationHash({ from: fromAddress, to: toAddress, score, comment })
      const result = await anchorReceiptHash(hash, privateKeyWif, fromAddress)
      txid = result.txId
    } else {
      txid = `demo-attest-${crypto.randomBytes(8).toString('hex')}`
    }

    db.prepare(`
      INSERT INTO identity_attestations (id, fromAddress, toAddress, score, comment, txid, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, fromAddress, toAddress, score, comment, txid, now)

    // Update attestation count
    db.prepare('UPDATE agent_identities SET attestationCount = attestationCount + 1 WHERE address = ?').run(toAddress)

    return { id, fromAddress, toAddress, score, comment, txid, createdAt: now }
  }

  /**
   * Get attestations for an agent
   */
  getAttestations(address: string): IdentityAttestation[] {
    const db = getDb()
    return db.prepare('SELECT * FROM identity_attestations WHERE toAddress = ? ORDER BY createdAt DESC').all(address) as IdentityAttestation[]
  }

  /**
   * Search identities
   */
  search(query?: string, type?: string): AgentIdentity[] {
    const db = getDb()
    let sql = 'SELECT * FROM agent_identities WHERE 1=1'
    const params: any[] = []

    if (query) {
      sql += ' AND (displayName LIKE ? OR address LIKE ?)'
      params.push(`%${query}%`, `%${query}%`)
    }
    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    sql += ' ORDER BY reputationScore DESC LIMIT 100'
    return db.prepare(sql).all(...params).map((r: any) => this.rowToIdentity(r))
  }

  private rowToIdentity(row: any): AgentIdentity {
    return {
      id: row.id,
      address: row.address,
      displayName: row.displayName,
      type: row.type,
      capabilities: JSON.parse(row.capabilities || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      reputation: {
        score: row.reputationScore,
        totalTransactions: row.totalTransactions,
        successRate: row.successRate,
        totalVolumeSats: row.totalVolumeSats,
        attestations: row.attestationCount,
      },
      registeredAt: row.registeredAt,
      lastUpdated: row.lastUpdated,
      onChainTxId: row.onChainTxId,
    }
  }
}
