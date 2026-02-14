import express from 'express'
import { WalletManager } from '@agentspay/core'

export function getApiKey(req: express.Request): string | null {
  const key = req.header('x-api-key') || req.header('authorization')
  if (!key) return null
  const m = key.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : key.trim()
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
