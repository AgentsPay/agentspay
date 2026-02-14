import express from 'express'
import { WalletManager } from '@agentspay/core'

const COOKIE_NAME = 'agentpay_session'
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Extract API key from (in priority order):
 * 1. httpOnly cookie (browser clients)
 * 2. x-api-key header (SDK/programmatic clients)
 * 3. Authorization: Bearer header (standard)
 */
export function getApiKey(req: express.Request): string | null {
  // 1. Cookie (browser)
  const cookieKey = req.cookies?.[COOKIE_NAME]
  if (cookieKey) return cookieKey

  // 2. Header (SDK)
  const key = req.header('x-api-key') || req.header('authorization')
  if (!key) return null
  const m = key.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : key.trim()
}

/**
 * Set auth cookie on response
 */
export function setAuthCookie(res: express.Response, apiKey: string): void {
  res.cookie(COOKIE_NAME, apiKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}

/**
 * Clear auth cookie
 */
export function clearAuthCookie(res: express.Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

export function requireApiKey(wallets: WalletManager) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = getApiKey(req)
    if (!apiKey) return res.status(401).json({ error: 'API key required' })
    const wallet = wallets.getByApiKey(apiKey)
    if (!wallet) return res.status(401).json({ error: 'Invalid API key' })
    ;(req as any).authWallet = wallet
    ;(req as any).apiKey = apiKey
    next()
  }
}

export function requireWalletMatch(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = (req as any).authWallet as { id: string } | undefined
  if (!auth) return res.status(500).json({ error: 'Auth context missing' })
  if (req.params.id !== auth.id) return res.status(403).json({ error: 'Forbidden' })
  next()
}
