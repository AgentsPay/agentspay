import { WebhookManager, type WebhookEvent } from './webhook'
import { config } from '../config'

/**
 * Webhook Delivery Service
 * 
 * - Fire-and-forget delivery (doesn't block main flow)
 * - Automatic retries with exponential backoff (3 attempts max)
 * - HMAC-SHA256 signature verification
 * - Idempotency keys
 * - Audit log for all deliveries
 */
export class WebhookDelivery {
  private webhookManager = new WebhookManager()
  private retryIntervals = [0, 60_000, 300_000] // 0s, 1min, 5min
  private deliveryTimeoutMs = 15_000 // 15s timeout per attempt

  /**
   * Trigger a webhook event (fire-and-forget)
   */
  async trigger(eventType: WebhookEvent, payload: any): Promise<void> {
    // Get all active webhooks subscribed to this event
    const webhooks = this.webhookManager.getActiveWebhooksForEvent(eventType)

    if (webhooks.length === 0) {
      console.log(`[Webhooks] No subscribers for event: ${eventType}`)
      return
    }

    console.log(`[Webhooks] Triggering event ${eventType} for ${webhooks.length} webhook(s)`)

    // Create deliveries for all webhooks (async, don't await)
    for (const webhook of webhooks) {
      this.deliverAsync(webhook.id, eventType, payload).catch(err => {
        console.error(`[Webhooks] Failed to deliver to ${webhook.id}:`, err.message)
      })
    }
  }

  /**
   * Async delivery with retries (internal)
   */
  private async deliverAsync(webhookId: string, eventType: string, payload: any): Promise<void> {
    const webhook = this.webhookManager.getById(webhookId)
    if (!webhook || !webhook.active) return

    // Add metadata to payload
    const enrichedPayload = {
      event: eventType,
      timestamp: new Date().toISOString(),
      data: config.demoMode ? this.sanitizePayloadForDemo(payload) : payload,
    }

    // Create delivery record
    const delivery = this.webhookManager.createDelivery(webhookId, eventType, enrichedPayload)

    // Attempt delivery (with retries)
    await this.attemptDelivery(delivery.id, webhook.url, enrichedPayload, delivery.signature, delivery.idempotencyKey)
  }

  /**
   * Attempt delivery with retries and exponential backoff
   */
  private async attemptDelivery(
    deliveryId: string,
    url: string,
    payload: any,
    signature: string,
    idempotencyKey: string,
    attemptNumber = 0
  ): Promise<void> {
    if (attemptNumber >= 3) {
      this.webhookManager.updateDelivery(deliveryId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
      })
      console.error(`[Webhooks] Delivery ${deliveryId} failed after 3 attempts`)
      return
    }

    const now = new Date().toISOString()

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.deliveryTimeoutMs)

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AgentPay-Webhooks/1.0',
          'X-AgentPay-Signature': signature,
          'X-AgentPay-Delivery': deliveryId,
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseBody = await response.text().catch(() => '')

      if (response.ok) {
        // Success
        this.webhookManager.updateDelivery(deliveryId, {
          status: 'success',
          attempts: attemptNumber + 1,
          lastAttemptAt: now,
          responseStatus: response.status,
          responseBody: responseBody.substring(0, 1000), // Limit stored response
          completedAt: now,
        })
        console.log(`[Webhooks] Delivery ${deliveryId} succeeded (attempt ${attemptNumber + 1})`)
      } else {
        // HTTP error - retry
        throw new Error(`HTTP ${response.status}: ${responseBody.substring(0, 200)}`)
      }
    } catch (error: any) {
      // Log the attempt
      const nextRetryDelay = this.retryIntervals[attemptNumber + 1]
      const nextRetryAt = nextRetryDelay
        ? new Date(Date.now() + nextRetryDelay).toISOString()
        : undefined

      this.webhookManager.updateDelivery(deliveryId, {
        attempts: attemptNumber + 1,
        lastAttemptAt: now,
        responseBody: error.message.substring(0, 1000),
        nextRetryAt,
      })

      console.warn(`[Webhooks] Delivery ${deliveryId} attempt ${attemptNumber + 1} failed: ${error.message}`)

      // Schedule retry
      if (nextRetryDelay !== undefined) {
        setTimeout(() => {
          this.attemptDelivery(deliveryId, url, payload, signature, idempotencyKey, attemptNumber + 1)
            .catch(err => console.error(`[Webhooks] Retry failed:`, err))
        }, nextRetryDelay)
      } else {
        // No more retries
        this.webhookManager.updateDelivery(deliveryId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
        })
      }
    }
  }

  /**
   * Process pending deliveries (for background worker/cron)
   */
  async processPending(): Promise<void> {
    const pending = this.webhookManager.getPendingDeliveries(100)
    
    if (pending.length === 0) return

    console.log(`[Webhooks] Processing ${pending.length} pending deliveries`)

    for (const delivery of pending) {
      const webhook = this.webhookManager.getById(delivery.webhookId)
      if (!webhook || !webhook.active) {
        this.webhookManager.updateDelivery(delivery.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
        })
        continue
      }

      await this.attemptDelivery(
        delivery.id,
        webhook.url,
        delivery.payload,
        delivery.signature,
        delivery.idempotencyKey,
        delivery.attempts
      ).catch(err => {
        console.error(`[Webhooks] Failed to process delivery ${delivery.id}:`, err)
      })
    }
  }

  /**
   * Sanitize payload for demo mode (replace sensitive data)
   */
  private sanitizePayloadForDemo(payload: any): any {
    if (typeof payload !== 'object' || payload === null) return payload

    const sanitized = { ...payload }

    // Replace IDs with demo prefixes
    if (sanitized.id && typeof sanitized.id === 'string') {
      sanitized.id = `demo-${sanitized.id.slice(0, 8)}`
    }

    // Replace wallet IDs
    for (const key of ['buyerWalletId', 'sellerWalletId', 'agentId']) {
      if (sanitized[key] && typeof sanitized[key] === 'string') {
        sanitized[key] = `demo-wallet-${sanitized[key].slice(0, 6)}`
      }
    }

    // Replace transaction IDs
    for (const key of ['txId', 'escrowTxId', 'releaseTxId']) {
      if (sanitized[key] && typeof sanitized[key] === 'string') {
        sanitized[key] = `demo-tx-${sanitized[key].slice(0, 8)}`
      }
    }

    return sanitized
  }
}

// Singleton instance
export const webhookDelivery = new WebhookDelivery()
