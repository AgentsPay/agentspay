import { v4 as uuid } from 'uuid'
import { getDb } from '../registry/db'
import { PaymentEngine } from '../payment/payment'
import { VerificationManager } from '../verification/verification'
import { webhookDelivery } from '../webhooks/delivery'
import type { Job, JobStatus } from '../types'

export class JobManager {
  private payments: PaymentEngine
  private verification: VerificationManager

  constructor(payments: PaymentEngine, verification: VerificationManager) {
    this.payments = payments
    this.verification = verification
  }

  /** Create a new pending job tied to an escrowed payment */
  create(
    serviceId: string,
    paymentId: string,
    buyerWalletId: string,
    providerWalletId: string,
    input: any,
    timeoutSeconds: number
  ): Job {
    const db = getDb()
    const id = uuid()
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + timeoutSeconds * 1000).toISOString()

    db.prepare(`
      INSERT INTO jobs (id, serviceId, paymentId, buyerWalletId, providerWalletId, status, input, createdAt, expiresAt)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, serviceId, paymentId, buyerWalletId, providerWalletId, JSON.stringify(input), now, expiresAt)

    return {
      id,
      serviceId,
      paymentId,
      buyerWalletId,
      providerWalletId,
      status: 'pending',
      input,
      createdAt: now,
      expiresAt,
    }
  }

  /** Get a single job by ID */
  getById(id: string): Job | null {
    const db = getDb()
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any
    return row ? this.rowToJob(row) : null
  }

  /** List jobs for a provider, optionally filtered by status */
  listForProvider(providerWalletId: string, status?: JobStatus, limit = 50): Job[] {
    const db = getDb()
    let sql = 'SELECT * FROM jobs WHERE providerWalletId = ?'
    const params: any[] = [providerWalletId]

    if (status) {
      sql += ' AND status = ?'
      params.push(status)
    }

    sql += ' ORDER BY createdAt DESC LIMIT ?'
    params.push(limit)

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map(this.rowToJob)
  }

  /** List jobs for a buyer, optionally filtered by status */
  listForBuyer(buyerWalletId: string, status?: JobStatus, limit = 50): Job[] {
    const db = getDb()
    let sql = 'SELECT * FROM jobs WHERE buyerWalletId = ?'
    const params: any[] = [buyerWalletId]

    if (status) {
      sql += ' AND status = ?'
      params.push(status)
    }

    sql += ' ORDER BY createdAt DESC LIMIT ?'
    params.push(limit)

    const rows = db.prepare(sql).all(...params) as any[]
    return rows.map(this.rowToJob)
  }

  /** Provider accepts a pending job → in_progress */
  accept(jobId: string, providerWalletId: string): Job {
    const db = getDb()
    const job = this.getById(jobId)
    if (!job) throw new Error('Job not found')
    if (job.providerWalletId !== providerWalletId) throw new Error('Not your job')
    if (job.status !== 'pending') throw new Error(`Cannot accept job with status: ${job.status}`)

    const now = new Date().toISOString()
    db.prepare('UPDATE jobs SET status = ?, acceptedAt = ? WHERE id = ?')
      .run('in_progress', now, jobId)

    return { ...job, status: 'in_progress', acceptedAt: now }
  }

  /** Provider submits result → completed, payment released */
  async submitResult(jobId: string, providerWalletId: string, output: any): Promise<Job> {
    const db = getDb()
    const job = this.getById(jobId)
    if (!job) throw new Error('Job not found')
    if (job.providerWalletId !== providerWalletId) throw new Error('Not your job')
    if (job.status !== 'in_progress') throw new Error(`Cannot submit result for job with status: ${job.status}`)

    const now = new Date().toISOString()

    // Update job
    db.prepare('UPDATE jobs SET status = ?, output = ?, completedAt = ? WHERE id = ?')
      .run('completed', JSON.stringify(output), now, jobId)

    // Release payment
    const payment = this.payments.getById(job.paymentId)
    if (payment) {
      db.prepare('UPDATE payments SET completedAt = ? WHERE id = ?').run(now, job.paymentId)

      // Create execution receipt
      const executionTimeMs = job.acceptedAt
        ? new Date(now).getTime() - new Date(job.acceptedAt).getTime()
        : new Date(now).getTime() - new Date(job.createdAt).getTime()

      try {
        await this.verification.createReceipt(
          payment,
          (job.input || {}) as Record<string, unknown>,
          (output || {}) as Record<string, unknown>,
          executionTimeMs
        )
      } catch {
        // Receipt creation is non-critical
      }

      this.payments.createAutoWalletApproval(job.paymentId, 'release', 'provider')
      await this.payments.release(job.paymentId)
    }

    // Trigger webhook
    webhookDelivery.trigger('service.executed', {
      serviceId: job.serviceId,
      paymentId: job.paymentId,
      jobId,
      output,
    }).catch(() => {})

    return { ...job, status: 'completed', output, completedAt: now }
  }

  /** Provider reports failure → failed, payment refunded */
  async fail(jobId: string, providerWalletId: string, error: string): Promise<Job> {
    const db = getDb()
    const job = this.getById(jobId)
    if (!job) throw new Error('Job not found')
    if (job.providerWalletId !== providerWalletId) throw new Error('Not your job')
    if (job.status !== 'pending' && job.status !== 'in_progress') {
      throw new Error(`Cannot fail job with status: ${job.status}`)
    }

    const now = new Date().toISOString()
    db.prepare('UPDATE jobs SET status = ?, error = ?, completedAt = ? WHERE id = ?')
      .run('failed', error, now, jobId)

    // Provider approves refund path and then payment is refunded
    this.payments.createAutoWalletApproval(job.paymentId, 'refund', 'provider')
    await this.payments.refund(job.paymentId)

    return { ...job, status: 'failed', error, completedAt: now }
  }

  /** Expire stale jobs where expiresAt < now and status = pending, refund payments */
  async expireStale(): Promise<number> {
    const db = getDb()
    const now = new Date().toISOString()

    const staleJobs = db.prepare(
      "SELECT * FROM jobs WHERE status = 'pending' AND expiresAt < ?"
    ).all(now) as any[]

    for (const row of staleJobs) {
      db.prepare("UPDATE jobs SET status = 'expired', completedAt = ? WHERE id = ?")
        .run(now, row.id)

      try {
        await this.payments.refund(row.paymentId)
      } catch {
        // Payment may already be refunded
      }
    }

    return staleJobs.length
  }

  private rowToJob(row: any): Job {
    return {
      id: row.id,
      serviceId: row.serviceId,
      paymentId: row.paymentId,
      buyerWalletId: row.buyerWalletId,
      providerWalletId: row.providerWalletId,
      status: row.status as JobStatus,
      input: row.input ? JSON.parse(row.input) : undefined,
      output: row.output ? JSON.parse(row.output) : undefined,
      error: row.error || undefined,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt || undefined,
      completedAt: row.completedAt || undefined,
      expiresAt: row.expiresAt,
    }
  }
}
