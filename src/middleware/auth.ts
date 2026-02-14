import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { config } from '../config'

/**
 * Simple API key authentication for agent-to-agent communication
 * 
 * Flow:
 * 1. Wallet creation returns API key (once)
 * 2. API key is hashed and stored in database
 * 3. All protected endpoints require: Authorization: Bearer <apiKey>
 * 4. Middleware verifies and attaches walletId to request
 */

export interface AuthRequest extends Request {
  walletId?: string
  address?: string
}

/**
 * Generate a secure API key (256 bits)
 */
export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Hash API key for storage (SHA-256)
 */
export function hashApiKey(apiKey: string): string {
  return crypto.createHash('sha256').update(apiKey).digest('hex')
}

/**
 * Verify API key against hash
 */
export function verifyApiKey(apiKey: string, hash: string): boolean {
  return hashApiKey(apiKey) === hash
}

/**
 * Authentication middleware - verify API key
 * Requires Authorization: Bearer <apiKey> header
 */
export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Demo mode: skip auth if enabled (can work independently of demoMode for testing)
  if (config.demoSkipAuth) {
    // Allow walletId in query/body for testing
    req.walletId = req.query.walletId as string || req.body?.walletId
    return next()
  }

  const authHeader = req.headers.authorization
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No API key provided' })
  }
  
  const apiKey = authHeader.substring(7)
  
  if (!apiKey || apiKey.length !== 64) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key format' })
  }

  try {
    const { getDb } = require('../registry/db')
    const db = getDb()
    
    const hashedKey = hashApiKey(apiKey)
    const wallet = db.prepare('SELECT id, address FROM wallets WHERE apiKeyHash = ?').get(hashedKey) as any
    
    if (!wallet) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' })
    }
    
    req.walletId = wallet.id
    req.address = wallet.address
    next()
  } catch (error) {
    return res.status(500).json({ error: 'Authentication error' })
  }
}

/**
 * Ownership verification middleware
 * Ensures the authenticated wallet matches the resource ID
 */
export function requireOwnership(paramName: string = 'id') {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const resourceId = req.params[paramName]
    
    if (resourceId !== req.walletId) {
      return res.status(403).json({ error: 'Forbidden: Not your resource' })
    }
    
    next()
  }
}

/**
 * Service ownership verification
 * Ensures the authenticated wallet owns the service being modified
 */
export function requireServiceOwnership(req: AuthRequest, res: Response, next: NextFunction) {
  const { getDb } = require('../registry/db')
  const db = getDb()
  
  const service = db.prepare('SELECT agentId FROM services WHERE id = ?').get(req.params.id) as any
  
  if (!service) {
    return res.status(404).json({ error: 'Service not found' })
  }
  
  if (service.agentId !== req.walletId) {
    return res.status(403).json({ error: 'Forbidden: Not your service' })
  }
  
  next()
}

/**
 * Payment involvement verification
 * Ensures the authenticated wallet is either buyer or seller
 */
export function requirePaymentInvolvement(req: AuthRequest, res: Response, next: NextFunction) {
  const { getDb } = require('../registry/db')
  const db = getDb()
  
  const payment = db.prepare('SELECT buyerWalletId, sellerWalletId FROM payments WHERE id = ?').get(req.params.id) as any
  
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' })
  }
  
  if (payment.buyerWalletId !== req.walletId && payment.sellerWalletId !== req.walletId) {
    return res.status(403).json({ error: 'Forbidden: Not your payment' })
  }
  
  next()
}
