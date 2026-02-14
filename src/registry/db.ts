import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename2 = __filename
const __dirname2 = path.dirname(__filename2)
const DB_PATH = process.env.AGENTPAY_DB || path.join(__dirname2, '../../data/agentpay.db')

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
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY,
      agentId TEXT NOT NULL REFERENCES wallets(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      price INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'POST',
      inputSchema TEXT,
      outputSchema TEXT,
      active INTEGER NOT NULL DEFAULT 1,
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
      status TEXT NOT NULL DEFAULT 'pending',
      txId TEXT,
      escrowTxId TEXT,
      releaseTxId TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      completedAt TEXT
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
    CREATE INDEX IF NOT EXISTS idx_utxos_wallet ON utxos(walletId);
    CREATE INDEX IF NOT EXISTS idx_utxos_spent ON utxos(spent);
    CREATE INDEX IF NOT EXISTS idx_utxos_txid_vout ON utxos(txid, vout);
  `)
}
