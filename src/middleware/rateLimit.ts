import rateLimit from 'express-rate-limit'
import { config } from '../config'

/**
 * Rate Limiting Middleware
 * Prevents abuse and DoS attacks
 */

/**
 * Global rate limit (all endpoints)
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.demoMode ? 1000 : 100, // 100 requests per minute (1000 in demo)
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.demoMode && config.demoSkipAuth, // Skip in full demo mode
})

/**
 * Strict limit for wallet creation
 */
export const walletCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.demoMode ? 100 : 5, // 5 wallets per IP per hour (100 in demo)
  message: { error: 'Wallet creation limit reached. Try again in 1 hour.' },
  skipSuccessfulRequests: false,
  skip: () => config.demoMode && config.demoSkipAuth,
})

/**
 * Service registration limit
 */
export const serviceRegistrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.demoMode ? 100 : 10, // 10 services per IP per hour (100 in demo)
  message: { error: 'Service registration limit reached. Try again in 1 hour.' },
  skip: () => config.demoMode && config.demoSkipAuth,
})

/**
 * Execution limit (prevent spam)
 */
export const executionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.demoMode ? 100 : 30, // 30 executions per minute (100 in demo)
  message: { error: 'Too many execution requests. Slow down.' },
  skip: () => config.demoMode && config.demoSkipAuth,
})

/**
 * Funding limit (testnet/demo only)
 */
export const fundingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.demoMode ? 100 : 10, // 10 funding requests per hour
  message: { error: 'Funding limit reached. Try again in 1 hour.' },
  skip: () => config.demoMode && config.demoSkipAuth,
})
