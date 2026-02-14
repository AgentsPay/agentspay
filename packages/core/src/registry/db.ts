import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = process.env.AGENTPAY_DB || path.join(process.cwd(), 'data', 'agentpay.db')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
  }
  return db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      publicKey TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      privateKey TEXT,
      apiKeyHash TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL REFERENCES wallets(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      price INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BSV',
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'POST',
      inputSchema TEXT,
      outputSchema TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      timeout INTEGER NOT NULL DEFAULT 30,
      disputeWindow INTEGER NOT NULL DEFAULT 30,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      serviceId TEXT NOT NULL REFERENCES services(id),
      buyerWalletId TEXT NOT NULL REFERENCES wallets(id),
      sellerWalletId TEXT NOT NULL REFERENCES wallets(id),
      amount INTEGER NOT NULL,
      platformFee INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'BSV',
      status TEXT NOT NULL DEFAULT 'pending',
      disputeStatus TEXT,
      txId TEXT,
      escrowTxId TEXT,
      releaseTxId TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      paymentId TEXT NOT NULL UNIQUE REFERENCES payments(id),
      buyerWalletId TEXT NOT NULL REFERENCES wallets(id),
      providerWalletId TEXT NOT NULL REFERENCES wallets(id),
      reason TEXT NOT NULL,
      evidence TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      splitPercent INTEGER,
      resolvedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS utxos (
      id TEXT PRIMARY KEY,
      walletId TEXT NOT NULL REFERENCES wallets(id),
      txid TEXT NOT NULL,
      vout INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      script TEXT NOT NULL,
      spent INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      spentAt TEXT,
      UNIQUE(txid, vout)
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id TEXT PRIMARY KEY,
      paymentId TEXT NOT NULL UNIQUE REFERENCES payments(id),
      fromAgentId TEXT NOT NULL REFERENCES wallets(id),
      toAgentId TEXT NOT NULL REFERENCES wallets(id),
      score INTEGER NOT NULL CHECK(score >= 1 AND score <= 5),
      comment TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
    CREATE INDEX IF NOT EXISTS idx_services_active ON services(active);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
    CREATE INDEX IF NOT EXISTS idx_payments_buyer ON payments(buyerWalletId);
    CREATE INDEX IF NOT EXISTS idx_payments_seller ON payments(sellerWalletId);
    CREATE INDEX IF NOT EXISTS idx_payments_dispute_status ON payments(disputeStatus);
    CREATE INDEX IF NOT EXISTS idx_disputes_payment ON disputes(paymentId);
    CREATE INDEX IF NOT EXISTS idx_disputes_buyer ON disputes(buyerWalletId);
    CREATE INDEX IF NOT EXISTS idx_disputes_provider ON disputes(providerWalletId);
    CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
    CREATE INDEX IF NOT EXISTS idx_utxos_wallet ON utxos(walletId);
    CREATE INDEX IF NOT EXISTS idx_utxos_spent ON utxos(spent);
    CREATE INDEX IF NOT EXISTS idx_utxos_txid_vout ON utxos(txid, vout);

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      secret TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      ownerId TEXT REFERENCES wallets(id),
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhookId TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      eventType TEXT NOT NULL,
      payload TEXT NOT NULL,
      signature TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      lastAttemptAt TEXT,
      nextRetryAt TEXT,
      responseStatus INTEGER,
      responseBody TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active);
    CREATE INDEX IF NOT EXISTS idx_webhooks_owner ON webhooks(ownerId);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhookId);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(status, nextRetryAt);

    CREATE TABLE IF NOT EXISTS execution_receipts (
      id TEXT PRIMARY KEY,
      paymentId TEXT NOT NULL UNIQUE REFERENCES payments(id),
      serviceId TEXT NOT NULL REFERENCES services(id),
      inputHash TEXT NOT NULL,
      outputHash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      executionTimeMs INTEGER NOT NULL,
      providerSignature TEXT NOT NULL,
      platformSignature TEXT NOT NULL,
      receiptHash TEXT NOT NULL UNIQUE,
      blockchainTxId TEXT,
      blockchainAnchoredAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_receipts_payment ON execution_receipts(paymentId);
    CREATE INDEX IF NOT EXISTS idx_receipts_service ON execution_receipts(serviceId);
    CREATE INDEX IF NOT EXISTS idx_receipts_hash ON execution_receipts(receiptHash);

    -- MNEE token ledger for demo mode
    CREATE TABLE IF NOT EXISTS mnee_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      txid TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_mnee_ledger_address ON mnee_ledger(address);
    CREATE INDEX IF NOT EXISTS idx_mnee_ledger_txid ON mnee_ledger(txid);
  `)

  // Migration: Add missing columns to existing tables
  // SQLite doesn't support IF NOT EXISTS on ALTER TABLE, so we use try/catch
  try { db.exec("ALTER TABLE payments ADD COLUMN disputeStatus TEXT DEFAULT 'none'") } catch(e) { /* column already exists */ }
  try { db.exec("ALTER TABLE payments ADD COLUMN completedAt TEXT") } catch(e) { /* column already exists */ }
  try { db.exec("ALTER TABLE services ADD COLUMN currency TEXT DEFAULT 'BSV'") } catch(e) { /* column already exists */ }
  try { db.exec("ALTER TABLE services ADD COLUMN timeout INTEGER DEFAULT 30") } catch(e) { /* column already exists */ }
  try { db.exec("ALTER TABLE services ADD COLUMN disputeWindow INTEGER DEFAULT 30") } catch(e) { /* column already exists */ }

  // Agent Identity tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_identities (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'agent',
      capabilities TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      reputationScore INTEGER DEFAULT 50,
      totalTransactions INTEGER DEFAULT 0,
      successRate REAL DEFAULT 1.0,
      totalVolumeSats INTEGER DEFAULT 0,
      attestationCount INTEGER DEFAULT 0,
      onChainTxId TEXT,
      registeredAt TEXT NOT NULL,
      lastUpdated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identity_attestations (
      id TEXT PRIMARY KEY,
      fromAddress TEXT NOT NULL,
      toAddress TEXT NOT NULL,
      score INTEGER NOT NULL,
      comment TEXT,
      txid TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_identities_address ON agent_identities(address);
    CREATE INDEX IF NOT EXISTS idx_identities_type ON agent_identities(type);
    CREATE INDEX IF NOT EXISTS idx_attestations_to ON identity_attestations(toAddress);
  `)
}
